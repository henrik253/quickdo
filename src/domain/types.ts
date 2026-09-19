/**
 * Shared domain types. This file is the contract between src/domain, src/server and src/web.
 * Keep it dependency-free (no node, no react). Field semantics: docs/PLAN.md §5, docs/CONTRACTS.md.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Status = 'open' | 'done' | 'skipped' | 'dropped';
export type Repeat = 'daily' | 'weekdays' | `weekly:${Weekday}`;
export type SourceKind = 'ui' | 'hotkey' | 'cli' | 'agent';

/** Wall-clock "HH:MM" in the configured timezone. */
export type HHMM = string;
/** Calendar date "YYYY-MM-DD" in the configured timezone. */
export type ISODate = string;
/** Instant, ISO 8601 with offset, e.g. "2026-09-18T09:12:03+02:00". */
export type ISOInstant = string;

export interface Block {
  start: HHMM;
  minutes: number;
}

export interface Fallback {
  title?: string;
  minutes: number;
  at?: HHMM;
}

export interface Source {
  kind: SourceKind;
  by?: string;
  ref?: string;
  dedupeKey?: string;
}

export interface LlmFormat {
  status: 'pending' | 'done' | 'failed' | 'skipped';
  raw: string; // the text exactly as captured, so a bad rewrite can always be recovered
  at?: ISOInstant;
  model?: string;
}

export interface Item {
  id: string; // ULID, assigned by the Mac
  title: string;
  note?: string;
  status: Status;
  scheduledFor?: ISODate; // present => on that day's list; absent => Backlog
  suggestedFor?: ISODate; // agent suggestion, never auto-applied
  block?: Block;
  estimateMin?: number; // raw; UI shows padded (derived)
  cue?: string; // implementation intention
  fallback?: Fallback;
  project?: string;
  tags: string[];
  due?: ISODate;
  repeat?: Repeat;
  checkpoint?: HHMM | null;
  rescheduleCount: number;
  order: number;
  source: Source;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
  /** Filled when a capture was handed to the formatting model (docs/ROADMAP.md, LLM formatting). */
  llm?: LlmFormat;
  startedAt?: ISOInstant; // set by `start`, cleared by done/undo/skip; used for slip detection
  completedAt?: ISOInstant;
  skippedOn?: ISODate;
  droppedAt?: ISOInstant;
  [extra: string]: unknown; // unknown fields are preserved on read
}

export interface TodosFile {
  version: 1;
  updatedAt: ISOInstant;
  items: Item[];
}

export interface Anchor {
  name: string;
  days: Weekday[];
  start: HHMM;
  end: HHMM;
}

export interface Schedule {
  version: 1;
  dayStart: HHMM;
  dayEnd: HHMM;
  slackMinutes: number;
  anchors: Anchor[];
}

export interface DayState {
  date: ISODate;
  freshStartAt: HHMM | null;
  eveningRitualDone: boolean;
}

/** The complete in-memory state the reducer operates on. */
export interface State {
  todos: TodosFile;
  schedule: Schedule;
  day: DayState;
}

export interface Settings {
  timezone: string; // IANA, e.g. "Europe/Berlin"
  dayStart: HHMM;
  dayEnd: HHMM;
  slackMinutes: number;
  eveningRitualAt: HHMM;
  todayCap: number; // soft cap, default 5
  slipGraceMin: number; // default 10
  defaultEstimateMin: number; // default 30
  paddingFactor: number; // default 1.3
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'Europe/Berlin',
  dayStart: '08:00',
  dayEnd: '22:00',
  slackMinutes: 90,
  eveningRitualAt: '20:00',
  todayCap: 5,
  slipGraceMin: 10,
  defaultEstimateMin: 30,
  paddingFactor: 1.3,
};

/** Injected everywhere time matters, so every rule is testable with a fake clock. */
export interface Clock {
  now(): Date;
  tz: string;
}

export type HistoryType =
  | 'added'
  | 'done'
  | 'undone'
  | 'skipped'
  | 'started'
  | 'extended'
  | 'rescheduled'
  | 'blocked'
  | 'unblocked'
  | 'dropped'
  | 'edited'
  | 'fallback'
  | 'fresh_start'
  | 'committed'
  | 'accepted'
  | 'ingested'
  | 'rejected'
  | 'ping'
  | 'archived'
  | 'migrated';

export interface HistoryEvent {
  ts: ISOInstant;
  type: HistoryType;
  day: ISODate;
  itemId?: string;
  from?: string | null;
  to?: string | null;
  reason?: string;
  by?: string;
  auto?: boolean;
  scope?: 'next_block_only';
  detail?: string;
}

// ---------- Capture ----------

export interface Token {
  kind:
    | 'schedule'
    | 'block'
    | 'estimate'
    | 'project'
    | 'tag'
    | 'cue'
    | 'fallback'
    | 'repeat'
    | 'due'
    | 'filter'
    | 'slot';
  raw: string;
  value: string;
}

export interface ParsedCapture {
  title: string;
  scheduledFor?: ISODate;
  block?: Block;
  wantsSlot?: boolean; // `!!` — Today + next free slot; the reducer resolves the slot
  estimateMin?: number;
  project?: string;
  tags: string[];
  cue?: string;
  fallback?: Fallback;
  repeat?: Repeat;
  due?: ISODate;
  filter?: string; // leading `?`: not a capture, a live filter
  tokens: Token[];
  warnings: string[];
}

// ---------- Actions (all reduced by src/domain/state/reducer.ts) ----------

export type CaptureTarget = 'today' | 'backlog' | 'today+slot';

export type EditablePatch = Partial<
  Pick<
    Item,
    | 'title'
    | 'note'
    | 'cue'
    | 'fallback'
    | 'estimateMin'
    | 'block'
    | 'due'
    | 'project'
    | 'tags'
    | 'repeat'
    | 'order'
    | 'checkpoint'
    | 'scheduledFor'
    | 'llm'
  >
>;

export type Action =
  | { type: 'add'; parsed: ParsedCapture; source: Source; target?: CaptureTarget }
  | { type: 'done'; id: string }
  | { type: 'undo'; id: string }
  | { type: 'skip'; id: string }
  | { type: 'drop'; id: string }
  | { type: 'start'; id: string }
  | { type: 'extend'; id: string; minutes?: number } // default +15
  | { type: 'reschedule'; id: string; to: ISODate | null } // null = Backlog
  | { type: 'setBlock'; id: string; start: HHMM; minutes?: number }
  | { type: 'clearBlock'; id: string }
  | { type: 'shiftBlock'; id: string; minutes: number } // ±15
  | { type: 'nextSlot'; id: string } // `n`: move THIS block to the next free slot; may move at most the ONE next block
  | { type: 'edit'; id: string; patch: EditablePatch; by?: string } // by: 'llm' for model rewrites
  | { type: 'accept'; id: string } // scheduledFor = suggestedFor
  | { type: 'freshStart' }
  | { type: 'rollover' } // uses clock date; open dated items from earlier days -> Backlog
  | { type: 'commitEvening'; ids: string[]; cues: Record<string, string> }
  | { type: 'ingest'; command: InboxCommand; file: string };

export interface ReduceResult {
  state: State;
  events: HistoryEvent[];
  changed: boolean;
  /** Set when a precondition failed; the UI shows it as a chip. state is unchanged then. */
  warning?: string;
  /** The item created or primarily affected, when there is one. */
  item?: Item;
}

// ---------- Agent inbox commands (docs/AGENT.md) ----------

export interface InboxAddItem {
  title: string;
  note?: string;
  estimateMin?: number;
  due?: ISODate;
  suggestedFor?: ISODate;
  project?: string;
  tags?: string[];
  cue?: string;
  ref?: string;
  dedupeKey?: string;
}

export type InboxCommand =
  | { v: 1; op: 'add'; by: string; at: ISOInstant; item: InboxAddItem }
  | {
      v: 1;
      op: 'update';
      by: string;
      at: ISOInstant;
      id?: string;
      dedupeKey?: string;
      baseUpdatedAt?: ISOInstant;
      patch: Partial<
        Pick<
          InboxAddItem,
          | 'title'
          | 'note'
          | 'due'
          | 'estimateMin'
          | 'project'
          | 'tags'
          | 'cue'
          | 'suggestedFor'
          | 'ref'
        >
      >;
    }
  | {
      v: 1;
      op: 'done';
      by: string;
      at: ISOInstant;
      id?: string;
      dedupeKey?: string;
      baseUpdatedAt: ISOInstant;
    }
  | { v: 1; op: 'ping'; by: string; at: ISOInstant };

export interface IngestOutcome {
  file: string;
  ok: boolean;
  /** 'schema: <path>' | 'stale: item changed at <ts>' | 'not_found' | 'gone' | 'duplicate' | 'not_a_command_file' */
  error?: string;
  itemId?: string;
  op?: InboxCommand['op'];
}

// ---------- Derived read model (src/domain/state/derive.ts) ----------

export interface HabitView {
  item: Item;
  dueToday: boolean;
  doneToday: boolean;
  done7: number; // done days among the last 7 due days
  due7: number;
  missedYesterday: boolean;
}

export interface Derived {
  date: ISODate;
  now: HHMM;
  today: Item[]; // open + skipped, non-repeat, scheduledFor === date; sorted by block start, then order
  doneToday: Item[]; // non-repeat, status done, completedAt on date
  habits: HabitView[];
  backlog: Item[]; // open, no scheduledFor, no repeat; order asc
  upcoming: Array<{ date: ISODate | 'later'; items: Item[] }>;
  progress: {
    done: number;
    skipped: number;
    open: number;
    segments: Array<{ id: string; title: string; status: 'done' | 'skipped' | 'open' }>;
    habitsDone: number;
    habitsDue: number;
  };
  capacity: {
    freeMin: number; // dayEnd - max(now, dayStart, freshStartAt)
    busyMin: number; // anchors ∪ blocks within the remaining window
    slackMin: number;
    plannedMin: number; // Σ padded(unblocked open Today items)
    remainingMin: number; // freeMin - busyMin - slackMin - plannedMin
    ratio: number; // used / free, 0..∞
    level: 'ok' | 'amber' | 'red';
  };
  overCap: boolean; // today.length > settings.todayCap
  padded: Record<string, number>; // itemId -> padded minutes
  slips: Array<{ id: string; kind: 'notStarted' | 'overran' }>;
  busy: Array<{
    start: HHMM;
    end: HHMM;
    kind: 'anchor' | 'block' | 'calendar';
    label: string;
    id?: string;
  }>;
}
