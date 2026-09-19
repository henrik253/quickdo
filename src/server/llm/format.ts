/**
 * LLM formatting of captures: a quickly typed line ("for this and that this needs to change until
 * friday") becomes a clean, actionable todo. The item is stored immediately (the fast path never
 * waits); the model runs afterwards and patches the item. Parser-extracted fields always win over
 * the model's guesses; the raw text is kept in `item.llm.raw`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { weekdayOf } from '../../domain/time';
import type { EditablePatch, ISODate, Item, ParsedCapture } from '../../domain/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const FormatResultSchema = z.object({
  title: z
    .string()
    .describe('One actionable line, verb first, ≤ 80 characters, in the user’s language.'),
  note: z
    .string()
    .nullable()
    .describe('Details that do not belong in the title (context, links, names). null if none.'),
  due: z
    .string()
    .nullable()
    .describe(
      'Deadline as YYYY-MM-DD, only when the text states one ("until Friday", "by the 30th"). null otherwise.',
    ),
  scheduledFor: z
    .string()
    .nullable()
    .describe(
      'YYYY-MM-DD only when the user says WHEN they will do it ("today", "tomorrow", "on Monday"). null otherwise.',
    ),
  estimateMin: z
    .number()
    .int()
    .nullable()
    .describe('Duration in minutes only when the text states one. null otherwise.'),
  project: z
    .string()
    .nullable()
    .describe('A short project name only if the text clearly names one. null otherwise.'),
  tags: z
    .array(z.string())
    .describe('0–3 short lowercase tags that are obvious from the text. Usually empty.'),
  cue: z
    .string()
    .nullable()
    .describe(
      'An if-then trigger only if the user names one ("after lunch", "when I am at the library"). null otherwise.',
    ),
});

export type FormatResult = z.infer<typeof FormatResultSchema>;

export interface FormatInput {
  raw: string;
  parsed: ParsedCapture;
  today: ISODate;
  tz: string;
}

export interface Formatter {
  model: string;
  /** False until an API key is present (the Anthropic formatter re-checks .env on every call). */
  available(): boolean;
  format(input: FormatInput): Promise<FormatResult>;
}

export const SYSTEM_PROMPT = `You tidy up todo items that a person typed in a hurry into a personal todo app.

Return the structured fields only. Rules:
- title: ONE actionable line that starts with a verb, at most 80 characters, in the same language the person used (German stays German, English stays English). Keep names, numbers and identifiers exactly. If the text is already a clean title, return it unchanged.
- note: everything worth keeping that does not fit the title (context, links, who said what). Otherwise null.
- due: only when a deadline is stated ("until Friday", "by 30 Sept", "deadline tomorrow"). Resolve relative dates from TODAY given below. Otherwise null.
- scheduledFor: only when the person says when they will DO it ("today", "tomorrow", "on Monday"). A deadline is not a plan; do not copy due into scheduledFor. Otherwise null.
- estimateMin: only when a duration is stated. Otherwise null.
- project, tags, cue: only when obvious from the text. Never invent.
- Fields already extracted by the app's own syntax are listed under EXTRACTED; do not contradict them and do not repeat their tokens in the title.
- Never add facts that are not in the text.`;

/** Build the user message. Deterministic, so identical captures produce identical requests. */
export function buildUserMessage(input: FormatInput): string {
  const extracted: string[] = [];
  const p = input.parsed;
  if (p.scheduledFor) extracted.push(`scheduledFor=${p.scheduledFor}`);
  if (p.block) extracted.push(`block=${p.block.start}`);
  if (p.estimateMin !== undefined) extracted.push(`estimateMin=${p.estimateMin}`);
  if (p.project) extracted.push(`project=${p.project}`);
  if (p.tags.length) extracted.push(`tags=${p.tags.join(',')}`);
  if (p.cue) extracted.push(`cue=${p.cue}`);
  if (p.due) extracted.push(`due=${p.due}`);
  if (p.repeat) extracted.push(`repeat=${p.repeat}`);
  return [
    `TODAY: ${input.today} (${weekdayOf(input.today)}), timezone ${input.tz}`,
    `EXTRACTED: ${extracted.length ? extracted.join(' ') : '(nothing)'}`,
    `TEXT AS TYPED: ${input.raw}`,
    `TITLE AFTER REMOVING SYNTAX TOKENS: ${p.title}`,
  ].join('\n');
}

export interface AnthropicFormatterOptions {
  /** Called per request so a key added to .env after boot is picked up without a restart. */
  getApiKey: () => string | null;
  model: string;
  timeoutMs?: number;
}

export class FormatterUnavailable extends Error {}

export function createAnthropicFormatter(opts: AnthropicFormatterOptions): Formatter {
  let client: Anthropic | null = null;
  let clientKey: string | null = null;
  const format = async (input: FormatInput): Promise<FormatResult> => {
    const apiKey = opts.getApiKey();
    if (!apiKey) throw new FormatterUnavailable('no ANTHROPIC_API_KEY');
    if (!client || clientKey !== apiKey) {
      client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 20_000, maxRetries: 1 });
      clientKey = apiKey;
    }
    const response = await client.messages.parse({
      model: opts.model,
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(input) }],
      output_config: { format: zodOutputFormat(FormatResultSchema) },
    });
    if (response.stop_reason === 'refusal') throw new Error('model refused');
    if (!response.parsed_output)
      throw new Error(`no structured output (stop_reason ${response.stop_reason})`);
    return response.parsed_output;
  };
  return { model: opts.model, available: () => opts.getApiKey() !== null, format };
}

/** A real calendar date only: matches the schema's YYYY-MM-DD rule and round-trips through Date. */
function cleanDate(v: string | null | undefined): ISODate | undefined {
  if (!v || !ISO_DATE.test(v)) return undefined;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  return ok ? v : undefined;
}

function cleanText(v: string | null | undefined, max: number): string | undefined {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * Merge the model's result into a patch for the item. Parser-extracted fields (and an explicit
 * capture target) win; the model only fills what is empty. Tags are unioned. The title is replaced
 * unless the model returned nothing usable.
 */
export function buildPatch(
  item: Item,
  parsed: ParsedCapture,
  result: FormatResult,
  meta: { at: string; model: string },
): EditablePatch {
  const patch: EditablePatch = {
    llm: { status: 'done', raw: item.llm?.raw ?? '', at: meta.at, model: meta.model },
  };
  const title = cleanText(result.title, 200);
  if (title && title !== item.title) patch.title = title;
  const note = cleanText(result.note, 5000);
  if (note && !item.note) patch.note = note;
  const due = cleanDate(result.due);
  if (due && !parsed.due && !item.due) patch.due = due;
  const scheduledFor = cleanDate(result.scheduledFor);
  if (
    scheduledFor &&
    !parsed.scheduledFor &&
    !item.scheduledFor &&
    scheduledFor >= item.createdAt.slice(0, 10)
  ) {
    patch.scheduledFor = scheduledFor;
  }
  if (
    result.estimateMin !== null &&
    result.estimateMin !== undefined &&
    result.estimateMin > 0 &&
    result.estimateMin <= 24 * 60 &&
    parsed.estimateMin === undefined &&
    item.estimateMin === undefined
  ) {
    patch.estimateMin = Math.round(result.estimateMin);
  }
  const project = cleanText(result.project, 100);
  if (project && !parsed.project && !item.project) patch.project = project.replace(/^#/, '');
  const cue = cleanText(result.cue, 500);
  if (cue && !parsed.cue && !item.cue) patch.cue = cue;
  const tags = (result.tags ?? [])
    .map((t) => t.trim().toLowerCase().replace(/^[#+]/, ''))
    .filter((t) => t && t.length <= 100)
    .slice(0, 3);
  if (tags.length) {
    const merged = [...new Set([...item.tags, ...tags])];
    if (merged.length !== item.tags.length) patch.tags = merged;
  }
  return patch;
}
