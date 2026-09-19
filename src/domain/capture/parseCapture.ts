/**
 * Capture grammar (docs/CONTRACTS.md §1, docs/PLAN.md §8). Order-independent whitespace tokens;
 * everything unparsed, joined by single spaces, is the title. `"quoted"` words are literal.
 */
import * as chrono from 'chrono-node';
import type {
  Clock,
  HHMM,
  ISODate,
  ParsedCapture,
  Repeat,
  Settings,
  Token,
  Weekday,
} from '../types';
import { addDays, hhmmToMin, nextWeekday, nowHHMM, offsetMinutes, padded, todayISO } from '../time';

const WEEKDAY_WORDS: Record<string, Weekday> = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tues: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
};

const TIME_WORD = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i;
const ISO_DATE_WORD = /^\d{4}-\d{2}-\d{2}$/;

interface Word {
  text: string;
  quoted: boolean;
}

/** Split on whitespace, keeping `"…"` spans together as literal (quoted) words. */
function tokenize(text: string): Word[] {
  const words: Word[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      const close = text.indexOf('"', i + 1);
      if (close !== -1) {
        const inner = text.slice(i + 1, close);
        for (const w of inner.split(/\s+/).filter(Boolean)) words.push({ text: w, quoted: true });
        i = close + 1;
        continue;
      }
    }
    let j = i;
    while (j < n && !/\s/.test(text[j])) j++;
    words.push({ text: text.slice(i, j), quoted: false });
    i = j;
  }
  return words;
}

/** True when a word starts a token (so a cue or a keyword phrase must stop before it). */
function isTokenStart(w: Word): boolean {
  if (w.quoted) return false;
  const t = w.text;
  const lower = t.toLowerCase();
  if (/^[!@~#+]\S/.test(t)) return true;
  return lower === 'when' || lower === 'if' || lower === 'then' || lower === 'every' || lower === 'due';
}

/** A relative/absolute day word: today, tmr, tomorrow, weekday, ISO date. */
function dayWord(word: string, today: ISODate, includeToday: boolean): ISODate | undefined {
  const w = word.toLowerCase();
  if (w === 'today' || w === 'tod') return today;
  if (w === 'tmr' || w === 'tomorrow' || w === 'tom') return addDays(today, 1);
  if (ISO_DATE_WORD.test(w)) return w;
  const wd = WEEKDAY_WORDS[w];
  if (wd) return nextWeekday(today, wd, includeToday);
  return undefined;
}

function parseTimeWord(word: string): HHMM | undefined {
  const m = TIME_WORD.exec(word);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${h < 10 ? '0' : ''}${h}:${min < 10 ? '0' : ''}${min}`;
}

function parseEstimate(word: string): number | undefined {
  const body = word.slice(1).toLowerCase();
  let m = /^(\d+(?:\.\d+)?)h(?:(\d+)m?)?$/.exec(body);
  if (m) return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  m = /^(\d+)m?$/.exec(body);
  if (m) return Number(m[1]);
  return undefined;
}

function parseRepeat(word: string): Repeat | undefined {
  const w = word.toLowerCase();
  if (w === 'day' || w === 'daily') return 'daily';
  if (w === 'weekday' || w === 'weekdays') return 'weekdays';
  const wd = WEEKDAY_WORDS[w];
  return wd ? `weekly:${wd}` : undefined;
}

interface AtResult {
  date: ISODate;
  time?: HHMM;
  consumed: number; // extra words used (0 or 1)
}

/** One chrono instance per parse: casual English, forward dates, reference = clock.now() in clock.tz. */
function chronoDate(word: string, clock: Clock): { date: ISODate; time?: HHMM } | undefined {
  const parser = new chrono.Chrono(chrono.en.configuration.createCasualConfiguration(false));
  const results = parser.parse(
    word,
    { instant: clock.now(), timezone: offsetMinutes(clock.now(), clock.tz) },
    { forwardDate: true },
  );
  const r = results[0];
  if (!r || r.index !== 0 || r.text.length !== word.length) return undefined;
  const c = r.start;
  const date = `${c.get('year')}-${pad(c.get('month') ?? 1)}-${pad(c.get('day') ?? 1)}`;
  const time = c.isCertain('hour') ? `${pad(c.get('hour') ?? 0)}:${pad(c.get('minute') ?? 0)}` : undefined;
  return { date, time };
}

/** `@9`, `@9:30`, `@14`, `@tue 14:00`, `@tomorrow 9`, `@mon`, `@2026-09-30 10:00`. */
function parseAt(words: Word[], i: number, clock: Clock, today: ISODate): AtResult | undefined {
  const body = words[i].text.slice(1);
  if (/^\d{1,2}(:\d{2})?(am|pm)?$/i.test(body)) {
    const bare = parseTimeWord(body);
    if (bare === undefined) return undefined;
    // bare time: before that time today → today, at/after → tomorrow
    const date = hhmmToMin(bare) > hhmmToMin(nowHHMM(clock)) ? today : addDays(today, 1);
    return { date, time: bare, consumed: 0 };
  }
  const next = words[i + 1];
  const nextTime = next && !next.quoted ? parseTimeWord(next.text) : undefined;
  let date = dayWord(body, today, true);
  let time = nextTime;
  if (!date) {
    const viaChrono = chronoDate(body, clock);
    if (!viaChrono) return undefined;
    date = viaChrono.date;
    time = nextTime ?? viaChrono.time;
  }
  return { date, time, consumed: nextTime !== undefined ? 1 : 0 };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function parseCapture(text: string, clock: Clock, settings: Settings): ParsedCapture {
  const tokens: Token[] = [];
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('?')) {
    const filter = trimmed.slice(1).trim();
    tokens.push({ kind: 'filter', raw: trimmed, value: filter });
    return { title: '', tags: [], filter, tokens, warnings };
  }

  const today = todayISO(clock);
  const words = tokenize(trimmed);
  const titleWords: string[] = [];
  const tags: string[] = [];
  let project: string | undefined;
  let estimateMin: number | undefined;
  let bangDate: ISODate | undefined; // from `!…`
  let explicitBacklog = false;
  let atDate: ISODate | undefined; // from `@…`
  let blockStart: HHMM | undefined;
  let wantsSlot: boolean | undefined;
  let cue: string | undefined;
  let repeat: Repeat | undefined;
  let due: ISODate | undefined;

  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const t = w.text;
    const lower = t.toLowerCase();
    if (w.quoted) {
      titleWords.push(t);
      i++;
      continue;
    }

    if (t === '!!') {
      wantsSlot = true;
      bangDate = today;
      explicitBacklog = false;
      tokens.push({ kind: 'slot', raw: t, value: today });
      i++;
      continue;
    }
    if (t.startsWith('!') && t.length > 1) {
      if (lower === '!backlog') {
        explicitBacklog = true;
        bangDate = undefined;
        tokens.push({ kind: 'schedule', raw: t, value: 'backlog' });
        i++;
        continue;
      }
      const d = dayWord(t.slice(1), today, true);
      if (d) {
        bangDate = d;
        explicitBacklog = false;
        tokens.push({ kind: 'schedule', raw: t, value: d });
        i++;
        continue;
      }
    }
    if (t.startsWith('@') && t.length > 1) {
      const at = parseAt(words, i, clock, today);
      if (at) {
        const raw = at.consumed ? `${t} ${words[i + 1].text}` : t;
        atDate = at.date;
        if (at.time) {
          blockStart = at.time;
          tokens.push({ kind: 'block', raw, value: at.time });
        } else {
          tokens.push({ kind: 'schedule', raw, value: at.date });
        }
        i += 1 + at.consumed;
        continue;
      }
    }
    if (t.startsWith('~') && t.length > 1) {
      const est = parseEstimate(t);
      if (est !== undefined) {
        estimateMin = est;
        tokens.push({ kind: 'estimate', raw: t, value: String(est) });
        i++;
        continue;
      }
    }
    if (t.startsWith('#') && t.length > 1) {
      const name = t.slice(1);
      if (project === undefined) {
        project = name;
        tokens.push({ kind: 'project', raw: t, value: name });
      } else {
        tags.push(name);
        tokens.push({ kind: 'tag', raw: t, value: name });
      }
      i++;
      continue;
    }
    if (t.startsWith('+') && t.length > 1) {
      tags.push(t.slice(1));
      tokens.push({ kind: 'tag', raw: t, value: t.slice(1) });
      i++;
      continue;
    }
    if (lower === 'when' || lower === 'if') {
      const cueWords: string[] = [];
      let j = i + 1;
      while (j < words.length && !isTokenStart(words[j])) {
        cueWords.push(words[j].text);
        j++;
      }
      if (cueWords.length > 0) {
        cue = cueWords.join(' ');
        const hasThen = j < words.length && words[j].text.toLowerCase() === 'then';
        const raw = words
          .slice(i, hasThen ? j + 1 : j)
          .map((x) => x.text)
          .join(' ');
        tokens.push({ kind: 'cue', raw, value: cue });
        i = hasThen ? j + 1 : j;
        continue;
      }
    }
    if (lower === 'every' && i + 1 < words.length && !words[i + 1].quoted) {
      const rep = parseRepeat(words[i + 1].text);
      if (rep) {
        repeat = rep;
        tokens.push({ kind: 'repeat', raw: `${t} ${words[i + 1].text}`, value: rep });
        i += 2;
        continue;
      }
    }
    if (lower === 'due' && i + 1 < words.length && !words[i + 1].quoted) {
      const d = dayWord(words[i + 1].text, today, true);
      if (d) {
        due = d;
        tokens.push({ kind: 'due', raw: `${t} ${words[i + 1].text}`, value: d });
        i += 2;
        continue;
      }
    }
    titleWords.push(t);
    i++;
  }

  const title = titleWords.join(' ').trim();
  const parsed: ParsedCapture = { title, tags, tokens, warnings };
  const scheduledFor = explicitBacklog ? undefined : (bangDate ?? atDate);
  if (scheduledFor) parsed.scheduledFor = scheduledFor;
  if (blockStart && scheduledFor) {
    parsed.block = { start: blockStart, minutes: padded(estimateMin, settings) };
  }
  if (wantsSlot && scheduledFor) parsed.wantsSlot = true;
  if (estimateMin !== undefined) parsed.estimateMin = estimateMin;
  if (project !== undefined) parsed.project = project;
  if (cue !== undefined) parsed.cue = cue;
  if (repeat !== undefined) parsed.repeat = repeat;
  if (due !== undefined) parsed.due = due;

  if (estimateMin !== undefined && estimateMin > 90) warnings.push('estimate over 90 min — split?');
  if (title === '') warnings.push('no title');
  return parsed;
}
