# Module contracts

This file is the build contract between the five modules. Each module has an owner (a person or an
agent), owns the paths listed, and builds only against the interfaces here and in
`src/domain/types.ts` / `src/server/sync/types.ts`. When something here is wrong or missing, fix it
here first, then in code. Semantics beyond this file: `docs/PLAN.md`.

## Ownership

| Module | Owns | Must not touch |
|---|---|---|
| **domain** | `src/domain/**`, `scripts/schema-build.ts`, `schema/*.json` (generated) | anything else |
| **server** | `src/server/**` except `src/server/sync/**`, `test/server/**` except `test/server/sync*`, `test/fixtures/**` | `src/server/sync/**` |
| **sync** | `src/server/sync/**` (replaces the stub `index.ts`), `test/server/sync*.test.ts`, `test/fixtures/inbox/**` | `src/server/state.ts`, routes |
| **web** | `src/web/**`, `index.html`, `public/**` except icons, `e2e/**` | server code |
| **ops** | `bin/**`, `launchd/**`, `scripts/**` except `schema-build.ts`, `public/icons/**`, `public/icon.svg`, `.github/**`, `docs/SETUP.md`, `docs/AGENT.md`, `docs/ACCEPTANCE.md`, `features.yaml` (test refs only), `docs/shortcuts/**` | app code |

Shared, edited only by the integrator: `package.json`, `tsconfig*.json`, `vite.config.ts`,
`vitest.config.ts`, `playwright.config.ts`, `biome.json`, `src/domain/types.ts`,
`src/server/sync/types.ts`, `docs/ROADMAP.md`. If you need a dependency, run `npm i <pkg>` (it edits
`package.json`; say so in your report). Never put personal data in any file (fixtures use `alice`,
`Read paper X`, `Lecture A`; no real URLs outside `example.com`).

Tests carry the feature id in their title: `it('[F-004] rollover moves yesterday\'s open items to Backlog', …)`.
`features.yaml` lists the feature; `scripts/check-features.ts` cross-checks.

## 1. Domain (`src/domain`, pure: no I/O, no node/react imports, checked by `tsconfig.domain.json`)

Files and exports:

- `time.ts` — `todayISO(clock)`, `nowHHMM(clock)`, `toInstant(clock)` (ISO with offset in `clock.tz`),
  `addDays(iso, n)`, `weekdayOf(iso): Weekday`, `nextWeekday(fromISO, wd, includeToday)`, `hhmmToMin`,
  `minToHHMM`, `padded(estimateMin | undefined, settings)` = `ceil((est ?? default) × factor / 5) × 5`,
  `dateOf(instant, tz)`, `hhmmOf(instant, tz)`. Use `@date-fns/tz` (`TZDate`) for tz math.
- `capture/parseCapture.ts` — `parseCapture(text, clock, settings): ParsedCapture`. Grammar (order-independent
  whitespace tokens; everything unparsed, joined by single spaces, is the title):

  | Token | Result |
  |---|---|
  | `!today` `!tmr` `!tomorrow` `!mon`…`!sun` `!backlog` | `scheduledFor` (`!mon` = next Monday, today if today is Monday) |
  | `!!` | `scheduledFor = today`, `wantsSlot = true` |
  | `@9` `@9:30` `@14` `@tue 14:00` `@tomorrow 9` `@mon` | `scheduledFor` + `block.start`; `block.minutes = padded(estimate)`; bare `@9` before 09:00 → today, at/after → tomorrow. Use `chrono-node` (`forwardDate: true`, ref = clock.now in tz) for `@<weekday/date> <time>`; hand-parse the bare `@H[:MM]` forms. `@mon` without time → `scheduledFor` only |
  | `~30m` `~1h` `~1h30` `~1.5h` `~90` | `estimateMin` |
  | `#thesis` | first `#` → `project`; further `#x` → tags |
  | `+tag` | tags |
  | `when …` / `if … then …` | `cue` = text after `when`/`if` up to the next token or `then`; with `then`, the part after `then` is the title |
  | `every day` / `every weekday` / `every mon`…`every sunday` | `repeat` |
  | `due fri` / `due 2026-09-30` / `due tomorrow` | `due` |
  | `"quoted text"` | literal words, no token parsing inside (quotes removed) |
  | leading `?` | `filter = rest`, `title = ''` — not a capture |

  `warnings`: e.g. `estimate over 90 min — split?`, `no title`. `tokens` lists every parsed token for the chip preview.
  Title is trimmed; empty title with no filter → `warnings` includes `'no title'`.
- `state/initial.ts` — `emptyTodos(clock)`, `defaultSchedule(settings)`, `emptyDay(clock)`, `emptyState(clock, settings)`.
- `state/reducer.ts` — `reduce(state, action, clock, settings): ReduceResult`; `newId(clock)` (ULID seeded with clock time).
  Never mutates its input. A failed precondition returns `{ state, events: [], changed: false, warning }`.

  | Action | Precondition | Effect |
  |---|---|---|
  | `add` | title non-empty (or `warning: 'no title'`) | new `open` item from `parsed`; `scheduledFor` from parsed or `target` (`today` → date, `backlog` → none, `today+slot` → today + block at next free slot); `wantsSlot` likewise; Backlog order = min−1 (top), dated order = max+1; history `added` |
  | `done` | status ∈ {open, skipped} | non-repeat: `status: done`, `completedAt`, clears `startedAt`; repeat: status unchanged, history `done` only (per-day) |
  | `undo` | status ∈ {done, skipped}, or repeat done today (needs history → see `derive`; for repeat items the reducer emits history `undone`) | back to `open`, clears `completedAt`/`skippedOn` |
  | `skip` | open | `status: skipped`, `skippedOn: date`; repeat: history only |
  | `drop` | not done | `status: dropped`, `droppedAt` |
  | `start` | on Today | `startedAt = now`; history `started` |
  | `extend` | has block | `block.minutes += minutes (default 15)`; if it now overlaps the next block, that ONE block moves by the overlap |
  | `reschedule {to}` | not dropped | `scheduledFor = to` (or removed); `rescheduleCount++` if moving later or to Backlog; block cleared; history `rescheduled` |
  | `setBlock` | `scheduledFor` set | `block = {start, minutes ?? padded}`; `checkpoint` = midpoint if minutes ≥ 60 and unset; history `blocked` |
  | `clearBlock` | has block | removes block; history `unblocked` |
  | `shiftBlock` | has block | `start += minutes`, clamped to day window |
  | `nextSlot` | has block or on Today | `block.start = nextFreeSlot(now, padded, busy)`; on overlap only the single next block moves; history `rescheduled {scope: next_block_only}` |
  | `edit` | exists, not dropped | applies `patch` (only listed fields); history `edited` |
  | `accept` | has `suggestedFor` | `scheduledFor = suggestedFor`, clears it; history `accepted` |
  | `freshStart` | — | `day.freshStartAt = now`; past-due blocks (end < now) are removed from Today items (items stay on Today); future blocks untouched; history `fresh_start` |
  | `rollover` | — | if `day.date !== today`: day reset (`freshStartAt: null`), open non-repeat items with `scheduledFor < today` → Backlog with `rescheduleCount++` and history `rescheduled {reason: 'rollover'}`; returns count via `detail` of a `rescheduled` event or `warning` unset; the server keeps the count for the chip |
  | `commitEvening` | — | for each id: `scheduledFor = tomorrow`, `cue = cues[id]` if given; `day.eveningRitualDone = true`; history `committed` |
  | `ingest` | valid command | `add` → Backlog item with `source: {kind:'agent', by, ref, dedupeKey}`; duplicate `dedupeKey` (among items) → warning `duplicate`, unchanged; `update` → target by id/dedupeKey, `baseUpdatedAt` required for title/note/cue/due/estimateMin patches (mismatch → warning `stale: item changed at <updatedAt>`), `ref`/`suggestedFor`/`tags` (union) may patch blind; `done` → needs `baseUpdatedAt`; `ping` → history `ping` only. Missing target → warning `not_found`; dropped target → `gone` |

  Every event's `ts` is `toInstant(clock)` and `day` is `todayISO(clock)`. `updatedAt` is set on every change of an item.
- `state/derive.ts` — `derive(state, clock, settings, history: HistoryEvent[] = []): Derived` (see `Derived` in types.ts).
  Repeat items: `dueToday` from `repeat` vs weekday; `doneToday` = a `done` history event for that item with `day === date`;
  `done7/due7` over the last 7 due days; `missedYesterday` = due yesterday and no `done` event that day.
  Slips: `notStarted` = block start + grace < now, no `startedAt`, status open, not masked by `freshStartAt`
  (block start < freshStartAt); `overran` = block end + grace < now and `startedAt` set and status open.
  `busy` = anchors for today's weekday + blocks of Today items (+ calendar later), sorted; capacity per types.ts
  (`level`: ratio ≥ 1 → red, ≥ 0.9 → amber).
- `plan/nextFreeSlot.ts` — `nextFreeSlot(fromHHMM, minutes, busy: Array<{start,end}>, dayEnd): HHMM | null`, 5-minute grid.
- `schema/index.ts` — zod 4 schemas: `ItemSchema` (passthrough for unknown keys), `TodosFileSchema`, `ScheduleSchema`,
  `DayStateSchema`, `InboxCommandSchema` (strict, `additionalProperties: false` semantics), `HistoryEventSchema`,
  `SettingsSchema`; helpers `parseTodosFile(raw: unknown): TodosFile` (throws `Error` whose message starts with the JSON path),
  `validateInboxCommand(raw: unknown): { ok: true; command } | { ok: false; error: string }`,
  `migrateTodos(raw: unknown): TodosFile` (v1 only today; ordered steps list for later),
  `INBOX_FILENAME = /^\d{8}T\d{9}Z-[a-z0-9-]{1,40}\.json$/`.
- `scripts/schema-build.ts` (domain owner) — writes `schema/{item,todos,schedule,inbox-command}.schema.json` with
  `z.toJSONSchema(schema, { target: 'draft-2020-12' })`; `npm run schema:build`. CI fails if the output is stale.

Tests: `src/domain/**/*.test.ts` — `parseCapture.test.ts` (≥ 40 table-driven cases incl. DST day 2026-10-25 and the `@9`
before/after rule), `reducer.test.ts` (every action + precondition; invariants), `derive.test.ts`, `nextFreeSlot.test.ts`,
`time.test.ts`, `schema.test.ts`, `reducer.property.test.ts` (fast-check: random action sequences never throw, ids unique,
`rescheduleCount` monotonic), `domain-purity.test.ts` (no file in `src/domain` imports `node:`, `react`, `fs`, `path`).

## 2. Server (`src/server`, Hono 4 on `@hono/node-server`, bound to 127.0.0.1)

**Config resolution** (`src/server/config.ts`): `QUICKDO_HOME` (default `os.homedir()`) →
`$HOME/.config/quickdo/config.json` (missing = defaults), state dir `$HOME/.local/state/quickdo/`, cache dir
`$HOME/.cache/quickdo/`. `dataDir` = `QUICKDO_DATA_DIR` ?? `config.dataDir` ?? `~/quickdo-data`. `port` =
`QUICKDO_PORT` ?? `config.port` ?? 7777. `QUICKDO_SYNC=off` disables git sync. `QUICKDO_TEST_CLOCK=1` enables
`POST /api/_test/clock`. `config.json` keys: `dataDir, port, timezone, dayStart, dayEnd, slackMinutes,
eveningRitualAt, todayCap, slipGraceMin, defaultEstimateMin, pollSeconds, reminders: {…}, hermesPatExpires`.
`config.example.json` at the repo root documents them.

**Data dir layout**: `todos.json`, `schedule.json`, `history/YYYY-MM.jsonl`, `archive/`, `inbox/`, `inbox/rejected/`,
`schema/`, `README.md`. Missing `todos.json` → created empty. Invalid → kept as `todos.json.invalid-<ts>`, the last
committed version (`git show HEAD:todos.json`) is loaded if available, else empty; the UI shows a red bar (`StateResponse.problems`).
`day.json` in the **state dir** (not the data repo) stores `DayState`.

**Boot** (`index.ts`): load config → `state.ts` load (migrate → validate) → `rollover` → create sync (`createSync(host)`) →
serve `dist/web` (static, SPA fallback to `index.html` for non-`/api` paths) + API → `sync.start()`. Log to stdout as
single-line JSON `{ts, level, msg, …}`. Graceful shutdown on SIGTERM/SIGINT (flush, `sync.stop()`).

**Writes** (`state.ts`): every mutation → reduce → if changed: update memory, append events to `history/YYYY-MM.jsonl`,
write `todos.json` atomically (tmp + rename, 2-space JSON, trailing newline), `sync.notifyLocalChange()`, broadcast SSE `state`.
`schedule.json` likewise on anchor changes.

**Security middleware** (`security.ts`) on every non-GET request: `Content-Type` must start with `application/json` (else 415);
header `X-Quickdo-Client: 1` required (else 403); `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (else 421);
if `Origin` is present it must be `http://127.0.0.1:<port>` or `http://localhost:<port>` (else 403). No CORS headers ever.

**Endpoints**

| Method + path | Body → result |
|---|---|
| `POST /api/capture` | `{ text: string; target?: 'today'|'backlog'|'today+slot'; source?: 'ui'|'hotkey'|'cli' }` → `201 { item, parsed: { tokens, warnings }, state: StateResponse }`; `400 { error }` on empty title |
| `POST /api/items/:id/:action` | action ∈ `done undo skip drop start extend today tomorrow backlog next accept clearBlock` (no body needed; `extend` accepts `{ minutes }`) → `200 { state }`; precondition failure → `409 { warning, state }`; unknown id → 404 |
| `PATCH /api/items/:id` | `EditablePatch` → `200 { state }` |
| `POST /api/day/freshStart` | → `200 { state }` |
| `POST /api/day/commit` | `{ ids: string[]; cues: Record<string,string> }` → `200 { state }` |
| `GET /api/state` | `StateResponse` |
| `GET /api/events` | SSE (below) |
| `POST /api/sync` · `GET /api/sync/status` | force a cycle → `{ sync: SyncStatus }`; status |
| `GET /api/schedule` · `PUT /api/schedule` | `Schedule` (validated) |
| `GET /api/health` | `{ ok: true, uptimeSec, version }` |
| `GET /api/version` | `{ app: '0.1.0', gitSha: string|null, buildSha: string }` |
| `POST /api/_test/clock` | `{ now: ISOInstant }` → sets the server clock (fixed until changed; `{ now: null }` resets to real time). 404 unless `QUICKDO_TEST_CLOCK=1` |

```ts
interface StateResponse {
  items: Item[]; schedule: Schedule; day: DayState; derived: Derived; settings: Settings;
  sync: SyncStatus; version: { app: string; gitSha: string | null; buildSha: string };
  rolloverCount: number;          // items moved back to Backlog by the last rollover (for the chip); 0 otherwise
  problems: string[];             // e.g. 'todos.json invalid at items[3].title (kept as todos.json.invalid-…)'
}
```

**SSE** `GET /api/events`: `text/event-stream`; first message `event: state` with the full `StateResponse`; then
`state` on every change, `sync` (`SyncStatus`) after every cycle, `agent` (`{ added: Item[]; changed: {id, field}[] }`)
when ingest changed something, `update` (`{ sha }`) when a code update is pending, `reminder` (later). A comment
keepalive every 25 s. Streams end cleanly when the client disconnects.

**SyncHost implementation** lives in `state.ts`/`index.ts` per `src/server/sync/types.ts`.

Tests (`test/server/*.test.ts`, Vitest, real temp dirs, `app.request()` — no port): `api.capture.test.ts`,
`api.items.test.ts`, `security.test.ts`, `state.boot.test.ts` (missing/invalid/migration), `sse.test.ts`
(first chunk is a `state` event), `config.test.ts`. Export `createApp(deps)` from `src/server/app.ts` so tests build the
app in-process; `index.ts` only wires real deps and listens.

## 3. Sync (`src/server/sync`, git via `simple-git`, one `p-queue` mutex)

Implements `createSync(host, opts)` per `types.ts` and `docs/PLAN.md` §6. Summary: cycle every `pollSeconds`, on
`forceCycle`, and after `notifyLocalChange` debounces (commit 3 s → push 15 s). Cycle: commit dirty Mac-owned paths
(explicit `git add` of `todos.json schedule.json history archive`) → `ls-remote` (network error → `offline`, backoff
5 s → 5 min, return) → skip if remote unchanged and nothing to push and `inbox/` empty → `fetch` + `rebase --autostash`
(failure → RECOVERY) → `host.reloadFromDisk()` if the rebase changed Mac-owned files → ingest `inbox/*.json` (regular
files, name matches `INBOX_FILENAME`, ≤ 32 KB, JSON, `validateInboxCommand`; valid → `host.ingest` → `git rm`; invalid →
`git mv` to `inbox/rejected/` + `<name>.error.txt`) → `host.flush()` → commit `ingest: N from <by> (M rejected)` → push
(non-ff → fetch/rebase/push, 3 tries) → status + `host.emit('sync')`, and `host.emit('agent', {added, changed})` when
ingest changed state. All git commands with a 15 s timeout and `GIT_TERMINAL_PROMPT=0`. RECOVERY: `rebase --abort`,
`git branch conflict/<ts>`, `reset --hard origin/<branch>`, `checkout conflict/<ts> -- <Mac-owned paths>`, take `inbox/`
from origin, `host.reloadFromDisk()`, re-ingest, commit `resolve: restore Mac-owned paths`, push, `status.conflict`.
If the data dir is not a git repo or has no `origin`, sync starts in `enabled: false` mode and logs why (the app must still work).

Tests (`test/server/sync.git.test.ts`, `test/server/sync.inbox.test.ts`): a bare repo in `os.tmpdir()`, a "mac" clone
and a "hermes" clone; scenarios: inbox file → ingested + deleted + pushed; concurrent pushes rebase cleanly with zero
merge commits; contract violation (hermes edits `todos.json`) → RECOVERY, `conflict/*` branch exists, Mac version restored;
unreachable remote (`origin` pointing at a closed port) for several cycles → offline badge, no conflict branch, local commits
accumulate, then recover; 20 rapid local changes while hermes pushes → all present, zero merge commits; invalid inbox
file → `rejected/` + error file; oversize / bad name → rejected. Use an in-memory `SyncHost` fake.

## 4. Web (`src/web`, React 18 + zustand 5, plain CSS variables, no UI kit)

- `main.tsx` mounts `App`; registers the PWA SW via `virtual:pwa-register/react` (`useRegisterSW`, prompt mode; apply
  only when the capture bar is empty).
- `api.ts` — typed fetch helpers; every mutating call sends `Content-Type: application/json` and `X-Quickdo-Client: 1`.
- `store.ts` — zustand store: `{ state: StateResponse | null; connected: boolean; toast; draft; mode: 'capture'|'list'|'ritual'; cursor: string|null; view: 'backlog'|'upcoming' }`;
  `EventSource('/api/events')` feeds `state`; optimistic updates run the shared `reduce` on `items` and are replaced by the
  next `state` event; failures show a chip and keep the draft in `localStorage`.
- `focus.ts` — the two-mode focus model (`docs/PLAN.md` §8) as a pure key → action mapper, tested.
- Components: `CaptureBar` (input + live chips from `parseCapture`, Enter, ⌘Enter, Esc, ↑ recall, `?` filter),
  `TodayList` (rows with keys, done section, soft-cap amber header when `derived.overCap`, rollover chip), `HabitsStrip`,
  `Backlog`, `Upcoming`, `ProgressBar` (segments + label + `habitsDone/habitsDue`), `Timeline` (vertical day column:
  anchors, blocks, now-line, slack band; capacity meter), `SlipBanner` (rows with slips: `2 o n f T s`), `TipBar`
  (`tips.json`, rotates every 10 min, contextual group), `SyncBadge`, `StartingBanner` (SSE disconnected → "server
  starting… retrying", polls `/api/health` every 2 s), `KeyHelp` (`?`).
- `tips.json` — `[{ text, practice, source, group: 'planning'|'capacity'|'slip'|'habit'|'review' }]` from `docs/PLAN.md`
  appendix (synthetic content only).
- Keyboard map: `docs/PLAN.md` §8. Every action optimistic, then `POST`.
- Styles: `styles.css` with tokens for light and dark (`prefers-color-scheme`), ≥ 16 px gutters, works at 400 px.

Tests: `src/web/**/*.test.tsx` with Testing Library (`CaptureBar`, `TodayList`, `ProgressBar`, `SlipBanner`, `focus`,
`store`); `e2e/*.spec.ts` with Playwright against the real built server (`capture.spec.ts`, `today.spec.ts`,
`pwa.spec.ts`), each test tagged `[F-0xx]`.

## 5. Ops (`bin`, `launchd`, `scripts`, `.github`, docs)

- `bin/quickdo` (Node ESM, no build step, `#!/usr/bin/env node`): `quickdo "text" [--today]` → `POST /api/capture`
  (`source: 'cli'`), prints title + chips; `quickdo status` (sync status), `quickdo sync`, `quickdo open` (opens
  `http://127.0.0.1:7777`), `quickdo doctor` (node/git/gh on PATH, plist loaded, port answering, data dir is a git repo
  with `origin`, config present, secrets mode 600, no checkout under `~/Documents|Desktop|Downloads`), `quickdo install`
  / `quickdo uninstall` (launchd). Server down → clear message + exit 1.
- `bin/run.sh` — launchd entry: `cd` to the checkout; if `origin/stable` moved and the tree is clean: `git pull --ff-only`,
  `npm ci` if the lockfile changed, `npm run build` into `dist.next/` then swap to `dist/` (keep old on failure);
  finally `exec "$QUICKDO_NODE" dist/server.js`. Exit code 75 from the server = "restart me" (launchd `KeepAlive` does).
- `bin/install-launchd.sh` — renders `launchd/io.github.henrik253.quickdo.plist.template` (absolute node path from
  `command -v node`, `PATH` including nvm/homebrew dirs, `WorkingDirectory`, `RunAtLoad`, `KeepAlive`, `ThrottleInterval 5`,
  logs under `~/Library/Logs/quickdo/`), `launchctl bootstrap gui/$UID`; `bin/uninstall-launchd.sh` → `bootout`.
- `scripts/check-features.ts` — parses `features.yaml`; for every `done` feature each `tests` entry `file#title` must
  exist, the title must appear inside an `it(`/`test(` call (not `.skip`/`.todo`); every `[F-0xx]` tag in tests must map
  to a known feature; renders `docs/ACCEPTANCE.md`; exit 1 on violations. Test: `scripts/check-features.test.ts`.
- `scripts/check-no-pii.sh` — greps tracked files for ICS URL shapes, `ghp_`, `github_pat_`, `/Users/`, emails outside
  `example.com`; exit 1 on a hit.
- `.github/workflows/ci.yml` — jobs `lint`, `typecheck`, `unit` (`vitest run`), `e2e` (build then Playwright), `features`,
  `privacy`, `release` (main only, after all green: `git push origin HEAD:stable`; `permissions: contents: write`).
- `docs/SETUP.md` (fresh-Mac install, Chrome "Install app", the Shortcut, uninstall), `docs/AGENT.md` (the agent contract
  with worked examples = data repo README), `docs/shortcuts/README.md`.
- `public/icon.svg`, `public/icons/{192,512,maskable-512}.png` (simple mark: rounded square, teal, a check).
