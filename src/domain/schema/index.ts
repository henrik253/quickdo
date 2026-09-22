/**
 * Zod 4 schemas for every file on disk and for agent inbox commands, plus the JSON-Schema export
 * used by scripts/schema-build.ts. Items keep unknown keys; inbox commands reject them.
 */
import { z } from 'zod';
import type { InboxCommand, TodosFile } from '../types';

export const INBOX_FILENAME = /^\d{8}T\d{9}Z-[a-z0-9-]{1,40}\.json$/;
export const TODOS_VERSION = 1;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const ISODate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'expected YYYY-MM-DD');
const ISOInstant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
    'expected ISO 8601 instant with offset',
  );

export const WeekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const StatusSchema = z.enum(['open', 'done', 'skipped', 'dropped']);
export const RepeatSchema = z.enum([
  'daily',
  'weekdays',
  'weekly:mon',
  'weekly:tue',
  'weekly:wed',
  'weekly:thu',
  'weekly:fri',
  'weekly:sat',
  'weekly:sun',
]);
export const SourceKindSchema = z.enum(['ui', 'hotkey', 'cli', 'agent']);

export const BlockSchema = z.object({
  start: HHMM,
  minutes: z
    .int()
    .min(5)
    .max(24 * 60),
});

export const FallbackSchema = z.object({
  title: z.string().max(200).optional(),
  minutes: z
    .int()
    .min(1)
    .max(24 * 60),
  at: HHMM.optional(),
});

export const SourceSchema = z.object({
  kind: SourceKindSchema,
  by: z.string().max(80).optional(),
  ref: z.string().max(2000).optional(),
  dedupeKey: z.string().max(200).optional(),
});

export const LlmFormatSchema = z.object({
  status: z.enum(['pending', 'done', 'failed', 'skipped']),
  raw: z.string().max(5000),
  at: ISOInstant.optional(),
  model: z.string().max(100).optional(),
});

export const SubtaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  done: z.boolean(),
});

export const ItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    note: z.string().optional(),
    subtasks: z.array(SubtaskSchema).max(100).optional(),
    ongoing: z.boolean().optional(),
    ongoingSince: ISODate.optional(),
    status: StatusSchema,
    scheduledFor: ISODate.optional(),
    suggestedFor: ISODate.optional(),
    block: BlockSchema.optional(),
    estimateMin: z.int().min(0).optional(),
    cue: z.string().max(500).optional(),
    fallback: FallbackSchema.optional(),
    project: z.string().max(100).optional(),
    tags: z.array(z.string().max(100)),
    due: ISODate.optional(),
    repeat: RepeatSchema.optional(),
    checkpoint: HHMM.nullable().optional(),
    rescheduleCount: z.int().min(0),
    order: z.number(),
    source: SourceSchema,
    createdAt: ISOInstant,
    updatedAt: ISOInstant,
    llm: LlmFormatSchema.optional(),
    startedAt: ISOInstant.optional(),
    completedAt: ISOInstant.optional(),
    skippedOn: ISODate.optional(),
    droppedAt: ISOInstant.optional(),
  })
  .loose();

export const TodosFileSchema = z.object({
  version: z.literal(1),
  updatedAt: ISOInstant,
  items: z.array(ItemSchema),
});

export const AnchorSchema = z.object({
  name: z.string().min(1).max(100),
  days: z.array(WeekdaySchema),
  start: HHMM,
  end: HHMM,
});

export const ScheduleSchema = z.object({
  version: z.literal(1),
  dayStart: HHMM,
  dayEnd: HHMM,
  slackMinutes: z
    .int()
    .min(0)
    .max(24 * 60),
  anchors: z.array(AnchorSchema),
});

export const DayStateSchema = z.object({
  date: ISODate,
  freshStartAt: HHMM.nullable(),
  eveningRitualDone: z.boolean(),
});

export const HistoryTypeSchema = z.enum([
  'added',
  'done',
  'undone',
  'skipped',
  'started',
  'extended',
  'rescheduled',
  'blocked',
  'unblocked',
  'dropped',
  'edited',
  'fallback',
  'fresh_start',
  'committed',
  'accepted',
  'ingested',
  'rejected',
  'ping',
  'archived',
  'migrated',
]);

export const HistoryEventSchema = z.object({
  ts: ISOInstant,
  type: HistoryTypeSchema,
  day: ISODate,
  itemId: z.string().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  reason: z.string().optional(),
  by: z.string().optional(),
  auto: z.boolean().optional(),
  scope: z.literal('next_block_only').optional(),
  detail: z.string().optional(),
});

export const SettingsSchema = z.object({
  timezone: z.string().min(1),
  dayStart: HHMM,
  dayEnd: HHMM,
  slackMinutes: z.int().min(0),
  eveningRitualAt: HHMM,
  todayCap: z.int().min(1),
  slipGraceMin: z.int().min(0),
  defaultEstimateMin: z.int().min(1),
  paddingFactor: z.number().min(1),
});

// ---------- inbox commands (strict: unknown keys rejected) ----------

const InboxAddItemSchema = z
  .object({
    title: z.string().min(1).max(200),
    note: z.string().max(5000).optional(),
    estimateMin: z
      .int()
      .min(0)
      .max(24 * 60)
      .optional(),
    due: ISODate.optional(),
    suggestedFor: ISODate.optional(),
    project: z.string().max(100).optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
    cue: z.string().max(500).optional(),
    ref: z.string().max(2000).optional(),
    dedupeKey: z.string().min(1).max(200).optional(),
  })
  .strict();

const InboxPatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    note: z.string().max(5000).optional(),
    due: ISODate.optional(),
    estimateMin: z
      .int()
      .min(0)
      .max(24 * 60)
      .optional(),
    project: z.string().max(100).optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
    cue: z.string().max(500).optional(),
    suggestedFor: ISODate.optional(),
    ref: z.string().max(2000).optional(),
  })
  .strict();

const by = z.string().min(1).max(80);

export const InboxCommandSchema = z.discriminatedUnion('op', [
  z
    .object({ v: z.literal(1), op: z.literal('add'), by, at: ISOInstant, item: InboxAddItemSchema })
    .strict(),
  z
    .object({
      v: z.literal(1),
      op: z.literal('update'),
      by,
      at: ISOInstant,
      id: z.string().min(1).optional(),
      dedupeKey: z.string().min(1).max(200).optional(),
      baseUpdatedAt: ISOInstant.optional(),
      patch: InboxPatchSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      op: z.literal('done'),
      by,
      at: ISOInstant,
      id: z.string().min(1).optional(),
      dedupeKey: z.string().min(1).max(200).optional(),
      baseUpdatedAt: ISOInstant,
    })
    .strict(),
  z.object({ v: z.literal(1), op: z.literal('ping'), by, at: ISOInstant }).strict(),
]);

// ---------- helpers ----------

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '$';
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? String(seg) : `.${String(seg)}`;
  }
  return out;
}

function firstIssue(error: z.ZodError): { path: string; message: string } {
  const issue = error.issues[0];
  return { path: formatPath(issue?.path ?? []), message: issue?.message ?? 'invalid' };
}

/** Parse todos.json content; throws an Error whose message starts with the JSON path of the first problem. */
export function parseTodosFile(raw: unknown): TodosFile {
  const result = TodosFileSchema.safeParse(raw);
  if (!result.success) {
    const { path, message } = firstIssue(result.error);
    throw new Error(`${path}: ${message}`);
  }
  return result.data as TodosFile;
}

export function validateInboxCommand(
  raw: unknown,
): { ok: true; command: InboxCommand } | { ok: false; error: string } {
  const result = InboxCommandSchema.safeParse(raw);
  if (!result.success) {
    const { path, message } = firstIssue(result.error);
    return { ok: false, error: `schema: ${path}: ${message}` };
  }
  const command = result.data as InboxCommand;
  if ((command.op === 'update' || command.op === 'done') && !command.id && !command.dedupeKey) {
    return { ok: false, error: 'schema: id: either id or dedupeKey is required' };
  }
  return { ok: true, command };
}

/** Ordered, pure migration steps: each takes a file at version `from` and returns version `from + 1`. */
export const MIGRATIONS: ReadonlyArray<{
  from: number;
  run: (raw: Record<string, unknown>) => unknown;
}> = [];

/** Migrate a raw todos.json object up to TODOS_VERSION, then validate. */
export function migrateTodos(raw: unknown): TodosFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('$: expected an object');
  }
  let current = raw as Record<string, unknown>;
  let version = typeof current.version === 'number' ? current.version : 1;
  if (version > TODOS_VERSION)
    throw new Error(`version: ${version} is newer than supported ${TODOS_VERSION}`);
  while (version < TODOS_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) throw new Error(`version: no migration from ${version}`);
    current = step.run(current) as Record<string, unknown>;
    version += 1;
  }
  return parseTodosFile({ ...current, version });
}

/** The schemas published to schema/*.schema.json (and copied into the data repo). */
export const JSON_SCHEMAS = {
  item: ItemSchema,
  todos: TodosFileSchema,
  schedule: ScheduleSchema,
  'inbox-command': InboxCommandSchema,
} as const;

export type JsonSchemaName = keyof typeof JSON_SCHEMAS;

export function buildJsonSchema(name: JsonSchemaName): Record<string, unknown> {
  const schema = z.toJSONSchema(JSON_SCHEMAS[name], {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  });
  return { ...schema, $id: `https://example.com/quickdo/schema/${name}.schema.json` } as Record<
    string,
    unknown
  >;
}
