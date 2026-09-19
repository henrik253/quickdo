# Quickdo — master plan

*Working name. Status: draft for Henrik's approval, 2026-09-18. Nothing has been created yet (no repos, no code).*

Quickdo is a single-screen, keyboard-first todo app that lives in the Dock. It is an installed Chrome PWA served by a small local Node server that launchd starts at login. One capture line with a tiny quick-syntax, a global hotkey and a terminal command make appending a todo a two-second act. Data is plain JSON in a **private** git repo; the Mac is the only writer of the canonical file, and the external agent (Hermes) only ever drops new command files into an `inbox/` folder, so the two never conflict. The science-based practices from our conversation are the mechanics of the daily list, not decorations, and **none of them may add a step to the capture path**. Testing is first-class: every feature has an ID, and CI refuses to call a feature "done" unless a real, passing test references that ID.

The working rule for the whole project: **doing over planning.** Milestone 0 (capture in the browser, tested, CI green) is usable after one working day. Everything after that ships behind it in small PRs.

---

## 1. Goals and non-goals

**Goals**

- Capture in seconds from anywhere: app window, ⌃⌥Space (macOS Shortcut), or `quickdo "text"` in a terminal.
- One screen, zero modals, every action one key or one token. No follow-up prompts on the fast path.
- The daily method built in: master backlog vs. a tiny Today list, if-then cues, padded estimates against real capacity, a visible progress bar, time blocks with fixed anchors and slack, slip recovery that moves only the next block, fresh starts, never-miss-twice for habits, an evening ritual, a Sunday review, and rotating tips with their sources.
- Data as human- and LLM-readable JSON in git. Hermes can add and annotate todos through GitHub, and the open app shows those changes within 60 s without you doing anything.
- Runs as a Dock app that updates its own code from a CI-green branch.
- No personal data ever in the public repo, enforced by CI scanners.

**Non-goals (v1)**

- Multi-machine editing (one Mac writes; a second machine is out of scope).
- Priorities, sub-tasks, project browsers, drag-and-drop, mobile app, accounts, cloud hosting.
- Calendar events becoming todos automatically; full two-way calendar sync (v1 is read + one-way push).
- Encryption of data at rest (the private repo is the boundary, same trust model as `henrik253/knowledge`).
- Visible streak counters (a "5 of the last 7 days" figure replaces them; a streak reset is exactly the what-the-hell trigger we want to avoid).

## 2. Decisions

| # | Decision | Choice | Why | Rejected |
|---|---|---|---|---|
| D1 | Desktop shell | Installable PWA + local Node server as a launchd login agent | Node 20 is installed; Chrome "Install app" gives a Dock icon for free; the server can run git, the hotkey endpoint, ICS fetches and reminders | Tauri (needs Rust), Electron (heavy, own updater), pure static PWA (no git, no hotkey endpoint) |
| D2 | Server framework | Hono 4 + `@hono/node-server` | In-process `app.request()` makes API tests need no port; built-in SSE helper | Fastify, Express |
| D3 | Repos | Public `henrik253/quickdo` (code) + private `henrik253/quickdo-data` (data) | Personal data cannot reach the public repo by construction; the agent's token never touches code; free CI minutes on the public repo | Single private repo; encrypted data in a public repo (the LLM agent must read plaintext) |
| D4 | Storage shape | Mac-owned `todos.json` + `history/` + `archive/` + `schedule.json`; agent-owned `inbox/*.json` | One live file you and an LLM can read at a glance; **one writer per path** makes textual git conflicts between Mac and agent impossible | Per-item files (many files, harder for the agent to read state); per-writer event logs (needs a fold step to read state) |
| D5 | Agent write primitive | One new JSON file per command in `inbox/`, via the GitHub Contents API | No read-modify-write, no sha juggling; a malformed file hurts only itself | Appending to a shared file; GitHub Issues + Action |
| D6 | Agent authority | Agent items always land in Backlog; the agent may never set `status`, `scheduledFor` or `block`; it may set `suggestedFor` | The daily commitment is yours; the agent proposes, you decide with one key | Agent writes directly to Today |
| D7 | Today cap | Soft: from item 6 the Today header turns amber with "move one to tomorrow? (`T`)"; explicit intent always wins; habits are excluded | Overriding a stated intent breaks trust; the capacity meter already shows overload | Hard block; redirect the 6th item to Backlog |
| D8 | Capture default | No `!` token → Backlog; ⌘Enter or `!today` → Today | Keeps Today tiny; the fast path is one modifier | Default to Today |
| D9 | Progress bar | One segment per committed Today item (filled done, hatched skipped, empty open); skipped stays in the denominator | Shows *which* items are done; skipping does not shorten the day | Minute-weighted bar |
| D10 | Slip handling | Only the next block may move; fresh start (`.`) unblocks past-due items and never touches future blocks | Polivy & Herman; Dai et al.: a clean slate, not a re-plan | Re-lay out the remaining day |
| D11 | Habits | Per-item `repeat`; separate Habits strip; intervention fires after the *first* miss; UI shows "5 of last 7 days" | Lally et al.: one miss is harmless, the second is the one to prevent | Streak counter |
| D12 | Sync cadence | Every 60 s `git ls-remote` (cheap), fetch + rebase only when the remote moved; also on window focus; all git work behind one mutex | Cheapest correct check; serialisation stops the Mac racing itself on `index.lock` | Webhooks (can't reach a laptop); unserialised commit/push |
| D13 | Code self-update | Server checks the `stable` branch every 30 min; when it moved and the app is idle, the server exits and launchd restarts it through `run.sh`, which pulls, builds and keeps the old build if the new one fails to build | CI green on Linux ≠ boots on this Mac, so the old `dist/` must survive a bad build | Pull `main` blindly; manual updates only |
| D14 | Validation | zod 4 schemas are the single source: TypeScript types, runtime checks, and generated JSON Schema (`schema/*.json`) that the agent validates against | One definition, no drift | Hand-written JSON Schema |
| D15 | Feature ↔ test gate | `features.yaml` lists every feature with `status` and test references (`file#test title`); a CI script fails if a `done` feature has no existing, non-skipped test | "Done" cannot be claimed without a real passing test (your point 4) | `// @feature` comment tags |
| D16 | Calendars | Phase A read via private ICS URLs (no OAuth); Phase B one-way push of blocks to a dedicated Google calendar via OAuth; Outlook write only if the university tenant allows it | ICS is copy-paste and covers both providers for reading; two-way sync is the biggest rework risk for the least payoff | Two-way sync in v1; publishing an ICS feed (Google refreshes every 12–24 h) |
| D17 | Loopback hardening | Server binds `127.0.0.1`; mutating routes require `Content-Type: application/json` and a custom header `X-Quickdo-Client: 1`; `Host` must be `127.0.0.1:7777` | The custom header forces a CORS preflight, which a CORS-off server rejects, so a random web page cannot post todos; the `Host` check closes DNS rebinding | Bearer token (defends only against local processes, which a single-user Mac trusts) |

## 3. Architecture

```
┌──────────────────────────┐  HTTP + SSE   ┌──────────────────────────────────┐  git over HTTPS (gh credential helper)
│ Installed PWA (Chrome)   │◀────────────▶│ quickdo server (Node 20, Hono)   │◀──────────────────────────────▶ GitHub
│ React + Vite + zustand   │ 127.0.0.1:7777│ launchd login agent, KeepAlive   │        quickdo-data (private)
│ pinned tab also works    │               │ serves dist/web + /api/*         │                 ▲
└──────────────────────────┘               │ git mutex · reminders · ICS      │                 │ Contents API: PUT inbox/<file>.json
      ▲ ⌃⌥Space Shortcut / `quickdo` CLI   └──────────┬───────────────────────┘                 │
      │ → POST /api/capture                            │                                   Hermes (external server, fine-grained PAT)
                                           ~/quickdo-data/   ~/.config/quickdo/   ~/.cache/quickdo/
                                           todos.json …      config.json,         calendar.json
                                                             secrets.json
```

**Components (one npm package, TypeScript everywhere)**

- `src/domain/` — pure functions, zero I/O, zero React or Node imports (enforced by a separate `tsconfig.domain.json` and a purity test). `parseCapture.ts`, `reducer.ts` (every state change is `(state, action, clock) → state`), `rollover.ts`, `plan/{capacity,nextFreeSlot,slip,freshStart}.ts`, `habits.ts`, `rituals.ts`, `schema/*.ts` (zod), `clock.ts` (injected clock, so every time-based rule is testable).
- `src/server/` — Hono app: boot (validate → rollover → serve), `state.ts` (in-memory state, atomic writes via tmp+rename), routes, `security.ts` (D17), `sync/{mutex,git,inbox,recovery}.ts`, `reminders.ts`, `calendar/{ics,google,microsoft}.ts`, `update.ts`. Bundled with esbuild into one self-contained `dist/server.js`, so a broken `node_modules` can never take down the running app.
- `src/web/` — `App.tsx`, `store.ts` (zustand fed by `EventSource('/api/events')`, optimistic updates through the shared reducer), `focus.ts` (keyboard focus model), components: `CaptureBar`, `TodayList`, `HabitsStrip`, `Backlog`, `Upcoming`, `ProgressBar`, `Timeline`, `SlipBanner`, `TipBar`, `RitualStrip`, `ReviewStrip`, `SyncBadge`, `UpdatePill`, `StartingBanner`. Plain CSS with variables. `vite-plugin-pwa` supplies manifest, icons and a service worker that precaches the shell (so the app opens even while the server is restarting) and never caches `/api/*`.
- `bin/quickdo` — CLI: `quickdo "read paper X !today ~30m"`, `quickdo anchor add|rm`, `quickdo doctor`, `quickdo auth google`.
- `bin/run.sh` + `bin/install-launchd.sh` — launchd entry point and installer (renders the plist with the absolute node path, since launchd does not see your shell's PATH; logs under `~/Library/Logs/quickdo/`).
- `scripts/` — `check-features.ts`, `check-no-pii.sh`, `schema-build.ts`, `icons.ts`, `shortcuts/README.md` (the 6-step hotkey recipe).

**Endpoints** (bound to `127.0.0.1` only)

| Method + path | Purpose |
|---|---|
| `POST /api/capture` | `{ text, target?, source? }` → `201 { item, tokens, warnings }` |
| `POST /api/items/:id/{done,undo,skip,drop,today,tomorrow,backlog,start,extend,accept,fallback,next}` | one-key actions |
| `PATCH /api/items/:id` | partial edit (title, note, cue, estimate, block, due, project, tags, repeat, order) |
| `POST /api/day/{freshStart,commit,review}` | fresh start; evening commit `{ ids, cues }`; weekly review `{ dropped, kept }` |
| `GET /api/state` | full read model (items, habits, upcoming, schedule, capacity, progress) |
| `GET /api/events` | SSE: `state`, `sync`, `agent`, `reminder`, `update`, `tip` |
| `POST /api/sync`, `GET /api/sync/status` | force a sync cycle; `{ lastSync, pending, offline, conflict, hermesLastSeen }` |
| `GET /api/calendar?date=`, `POST /api/calendar/refresh` | cached calendar events; refetch ICS |
| `GET /api/schedule`, `PUT /api/schedule/anchors` | fixed anchors |
| `GET /api/health`, `GET /api/version`, `POST /api/update/restart` | liveness; running build sha; apply a pending update now |
| `POST /api/_test/clock` | sets the server clock; exists only with `QUICKDO_TEST_CLOCK=1` (used by e2e tests) |

**Self-refresh, two kinds**

1. *Data.* A sync cycle every 60 s, on window focus and on SSE connect (§ 6). A Hermes push is visible in the open window within 60 s while the Mac is awake; the first cycle after wake catches up.
2. *Code.* The production checkout `~/quickdo` tracks branch `stable`, which CI fast-forwards only after every test is green. The server checks `stable` every 30 min; if it moved and no mutation happened in the last 2 minutes, it drains pending pushes and exits with code 75. launchd's `KeepAlive` restarts it via `run.sh`: `git pull --ff-only origin stable` (refused on a dirty tree) → `npm ci` only if the lockfile changed → build into `dist.next/` → swap into `dist/` only on success → exec. If the build fails, the old `dist/` keeps serving and the pill in the UI says so. If the app is not idle, the UI shows "update ready — restart".

**Stack** (majors pinned; `engines.node` set; CI reads `.nvmrc`): Node 20.19 · TypeScript 5 · React 18 · Vite 7 · vite-plugin-pwa 1 · zustand 5 · Hono 4 · zod 4 · ajv 8 (draft 2020-12) · simple-git 3 · chokidar 4 · chrono-node 2 · ulid 3 · ical.js 2 · date-fns 4 + `@date-fns/tz` · esbuild · tsx · Vitest 3 (Vitest 5 needs Node 22) · @testing-library/react · Playwright · Biome 2 · gitleaks in CI. Deliberately absent: Tailwind, UI kits, Redux, Electron, Tauri, the `googleapis` SDK (plain `fetch` + PKCE is 80 lines). *Option:* moving to Node 22 LTS via nvm removes the Vitest pin and every other engine constraint; it is a one-line change to `.nvmrc`.

## 4. Repositories, privacy and secrets

| Repo | Visibility | Contents | Writers |
|---|---|---|---|
| `henrik253/quickdo` | public, MIT | code, tests, `tips.json`, `docs/`, generated `schema/*.json`, `config.example.json`, CI | you / Claude Code via PR |
| `henrik253/quickdo-data` | private | `todos.json`, `schedule.json`, `archive/`, `history/`, `inbox/`, `schema/` copy, `README.md` (the agent contract) | Mac server (everything except creating `inbox/*.json`); Hermes (new `inbox/` files only) |

**Where personal data and secrets live (never in the public repo)**

- `~/quickdo-data/` — clone of the private repo. Not under `~/Documents`: macOS gives launchd agents a silent permission error there.
- `~/.config/quickdo/config.json` — timezone, day window, slack minutes, evening ritual time, Today cap, default estimate, reminder toggles, Hermes PAT expiry date (for a 14-day warning).
- `~/.config/quickdo/secrets.json` (mode 600) — the two ICS URLs (they are bearer secrets), Google OAuth client id/secret, Microsoft client id. OAuth refresh tokens go into the login Keychain.
- `~/.cache/quickdo/calendar.json` — the only cache; calendar contents never enter any repo.
- Hermes's credential: a fine-grained PAT scoped to `quickdo-data` only, `Contents: read & write`, 1-year expiry. You create it; the plan never handles the value.

**Guardrails in the public repo**

- `.gitignore` for `.env*`, `data/`, `secrets/`, `tokens/`, `*.ics`, `dist*/`, test reports.
- `scripts/check-no-pii.sh` in CI and pre-commit: fails on Google/Outlook ICS URL shapes, `ghp_`/`github_pat_`, absolute paths under `/Users/`, and any email outside `example.com`. An optional local, git-ignored deny list adds real identifiers (the university name, calendar names) so they are caught locally but never appear in the public guard itself.
- `gitleaks` in CI.
- Every example in docs, fixtures and tips is synthetic (`alice`, `Read paper X`, `Lecture A`); the only real identifier in the public repo is the GitHub username in URLs.

## 5. Data model

**Files in `quickdo-data/`**

```
todos.json            live state (open + recently finished) — written only by the Mac
archive/2026-09.json  done > 14 days and dropped > 30 days, moved by the Sunday job
history/2026-09.jsonl append-only event log, one file per month (feeds progress, outcomes, consistency)
schedule.json         fixed anchors, day bounds, slack
inbox/                one JSON command per file; Hermes creates, the Mac consumes and deletes
inbox/rejected/       invalid commands + <name>.error.txt (the Mac writes, Hermes can read)
schema/*.schema.json  copied from the code repo; README states which version they match
README.md             the agent contract (identical to docs/AGENT.md in the code repo)
```

**Item fields**

| Field | Type | Notes |
|---|---|---|
| `id` | ULID | assigned by the Mac; the agent never sets ids |
| `title` | string ≤ 200 | the action; syntax tokens are stripped |
| `note` | string? | markdown, rendered escaped |
| `status` | `open` · `done` · `skipped` · `dropped` | repeat items stay `open`; their per-day outcome lives in history |
| `scheduledFor` | date? | present → on that day's list (Today or Upcoming); absent → Backlog. **This is the master/daily split.** |
| `suggestedFor` | date? | the agent's suggestion; shown as a chip, accepted with `a`, never auto-applied |
| `block` | `{ start: "HH:MM", minutes }`? | time block on `scheduledFor`; a block counts as a sufficient cue |
| `estimateMin` | int? | raw; the UI always shows `padded = ceil(estimate × 1.3 / 5) × 5` (derived, never stored) |
| `cue` | string? | the implementation intention ("when I sit down at the library at 9"); asked for only in the evening ritual or via `c` |
| `fallback` | `{ title?, minutes, at? }`? | if absent, "15 min at 16:00" is derived and offered only when a slip happens |
| `project`, `tags` | string?, string[] | from `#thesis` and `+tag` |
| `due` | date? | hard deadline, distinct from `scheduledFor` |
| `repeat` | `daily` · `weekdays` · `weekly:mon`…? | habit items |
| `checkpoint` | `"HH:MM"`? | midpoint reminder on blocks ≥ 60 min |
| `rescheduleCount` | int | +1 on every move to a later day or back to Backlog (including morning rollover); ≥ 3 flags it for the Sunday review |
| `order` | int | manual position within its list |
| `source` | `{ kind: ui·hotkey·cli·agent, by?, ref?, dedupeKey? }` | `ref` is a URL; `dedupeKey` makes agent adds idempotent |
| `createdAt`, `updatedAt`, `completedAt`, `skippedOn`, `droppedAt` | ISO | `updatedAt` is the agent's optimistic-concurrency token |

**`todos.json` (synthetic example)**

```json
{
  "version": 1,
  "updatedAt": "2026-09-18T09:12:03+02:00",
  "items": [
    {
      "id": "01K5G3ZQ8H0000000000000001",
      "title": "Read paper X, section 3",
      "status": "open",
      "scheduledFor": "2026-09-18",
      "block": { "start": "09:00", "minutes": 40 },
      "estimateMin": 30,
      "cue": "when I sit down at the library at 9",
      "project": "example",
      "tags": [],
      "rescheduleCount": 1,
      "order": 1,
      "source": { "kind": "hotkey" },
      "createdAt": "2026-09-17T20:41:10+02:00",
      "updatedAt": "2026-09-18T09:12:03+02:00"
    },
    {
      "id": "01K5G3ZQ8H0000000000000002",
      "title": "Reply to alice about the meeting slot",
      "status": "open",
      "suggestedFor": "2026-09-18",
      "estimateMin": 10,
      "due": "2026-09-19",
      "tags": ["mail"],
      "rescheduleCount": 0,
      "order": 14,
      "source": { "kind": "agent", "by": "hermes", "ref": "https://example.com/issues/1", "dedupeKey": "issue-1-reply" },
      "createdAt": "2026-09-18T07:03:00+02:00",
      "updatedAt": "2026-09-18T07:03:00+02:00"
    },
    {
      "id": "01K5G3ZQ8H0000000000000003",
      "title": "Water the fern",
      "status": "open",
      "repeat": "daily",
      "estimateMin": 5,
      "cue": "right after breakfast",
      "tags": ["habit"],
      "rescheduleCount": 0,
      "order": 9,
      "source": { "kind": "ui" },
      "createdAt": "2026-09-01T21:00:00+02:00",
      "updatedAt": "2026-09-17T22:10:00+02:00"
    }
  ]
}
```

**Derived, never stored:** padded estimates; `busy(day)` = union of anchors, calendar events and blocks; `capacity = (dayEnd − now) − busy − slack − Σ padded(unblocked Today items)` (amber at 90 %, red over 100 %); slip state (`notStarted` = block start + 10 min grace passed with no `started`/`done` event; `overran` = block end + grace passed); habit consistency over the last 7 due days; day outcome (`hit` = ≥ 1 committed item done, `miss`, `rest`), computed lazily from history.

**State transitions** live in one reducer; each action checks a precondition and returns a warning chip instead of silently doing nothing. Key ones: `add`, `done`, `undo`, `skip`, `start`, `extend`, `reschedule`, `rollover` (on boot and on the first activity of a new day: open dated items from yesterday go back to Backlog with `rescheduleCount++` and a chip "3 from yesterday moved to backlog (`t` = today)"), `setBlock`, `slipNext` (moves at most the one next block), `applyFallback`, `freshStart`, `accept`, `drop`, `commitEvening`, `reviewWeek`, `archive`, `ingest`.

**Migrations:** `version` in `todos.json` plus an ordered list of pure `vN → vN+1` steps, run on boot and committed once.

## 6. Sync protocol with the external agent

**Invariant: one writer per path.** `todos.json`, `archive/`, `history/`, `schedule.json`, `schema/`, `README.md` are Mac-only. `inbox/*.json` files are created only by the agent and deleted or moved to `inbox/rejected/` only by the Mac. Nobody edits a file it does not own, so a rebase never produces a textual conflict.

**Hermes side** (the contract lives in `docs/AGENT.md` = data repo `README.md`, with worked examples):

1. Optionally read state: `GET /repos/henrik253/quickdo-data/contents/todos.json` with `Accept: application/vnd.github.raw+json`; `schedule.json` for anchors; `inbox/rejected/` for feedback on its own mistakes.
2. Write one command per file, PUTs sequential: `PUT /repos/henrik253/quickdo-data/contents/inbox/<name>` with a base64 body. Filename grammar `^\d{8}T\d{9}Z-[a-z0-9-]{1,40}\.json$` (UTC timestamp + slug, so lexical order = time order). On `409`, re-PUT the same file.
3. Command shape (`schema/inbox-command.schema.json`, `additionalProperties: false`):
   ```json
   { "v": 1, "op": "add", "by": "hermes", "at": "2026-09-18T07:03:00Z",
     "item": { "title": "Reply to alice about the meeting slot", "estimateMin": 10, "due": "2026-09-19",
               "suggestedFor": "2026-09-18", "tags": ["mail"], "ref": "https://example.com/issues/1",
               "dedupeKey": "issue-1-reply" } }
   ```
   `op ∈ add | update | done | ping`. `add` always lands in Backlog. `update` needs `id` or `dedupeKey` plus a `patch` restricted to `title, note, due, estimateMin, project, tags, cue, suggestedFor, ref`; patches to `title`, `note`, `cue`, `due` or `estimateMin` must carry `baseUpdatedAt` (the `updatedAt` the agent read) and are rejected as `stale` if you edited the item since. `done` likewise needs `baseUpdatedAt`. `ping` is a daily heartbeat. **The agent can never set `status`, `scheduledFor` or `block`.**
4. Never touch a Mac-owned path, never invent ids, never modify or delete an existing inbox file. Re-sending the same `dedupeKey` is a safe no-op.
5. Feedback: ingested items show `source.by = "hermes"` in `todos.json`; rejected files land in `inbox/rejected/` with an `.error.txt`; the UI's sync badge shows "hermes last seen <date>" and turns amber after 7 days of silence.

A short note in `henrik253/knowledge` (template in `docs/AGENT.md`) tells Hermes the repo exists, the inbox convention, and "never touch todos.json".

**Mac side** (`src/server/sync/`), everything inside one mutex, polls coalesce:

```
cycle (every 60 s; on window focus; on SSE connect; right after a cycle that found inbox files):
  if local state is dirty: git add <explicit paths> && git commit -m "ui: …"
  remoteSha = git ls-remote --heads origin main          (15 s timeout, GIT_TERMINAL_PROMPT=0)
    network error → sync badge "offline", back off 5 s → 5 min, return   (never recovery)
  if remote unchanged and nothing to push and inbox/ is empty: return
  git fetch origin && git rebase --autostash origin/main  non-zero → RECOVERY
  ingest every regular file directly under inbox/ (name grammar, ≤ 32 KB):
    parse → Ajv (strict) → semantic checks (dedupe, baseUpdatedAt, target exists)
    valid   → reducer.ingest → git rm inbox/<file>
    invalid → git mv inbox/<file> inbox/rejected/<file> + write <file>.error.txt
  if state changed: write todos.json (tmp + rename), append history, commit "ingest: 2 from hermes (1 rejected)"
  git push  (non-fast-forward → fetch, rebase, push; 3 tries, then back off; offline → commits accumulate)
  emit SSE state + sync + agent { added, changed } → toast "Hermes added 2"

local mutation (capture, item action, edit):
  apply to memory → write todos.json atomically → append history → respond (< 10 ms)
  debounce 3 s → commit; debounce 15 s → push (both run as a cycle)
```

**RECOVERY** (rebase failed after a successful fetch, i.e. the agent broke the contract, or the tree is corrupt): `git rebase --abort`; `git branch conflict/<timestamp>` (nothing is ever lost); `git reset --hard origin/main`; restore every Mac-owned path from the conflict branch; take `inbox/` from origin; re-run ingest; commit `resolve: restore Mac-owned paths`; push; show a "conflict resolved, see branch …" line in the sync badge. Same procedure on boot if a recovery marker is present.

**Hand edits:** the server watches `todos.json` and `schedule.json`; a changed file that validates becomes the new state and is committed as `edit:`; an invalid one shows a red bar with the line number and the previous state is kept.

## 7. Features mapped to best practices

| ID | Feature | Behaviour | Practice + source |
|---|---|---|---|
| F-001 | Capture bar | Focused on open and after every capture; Enter appends; the new row flashes; a failed capture keeps the text as a draft | Capture everything (Allen 2001) |
| F-002 | Quick syntax + live chips | Tokens parsed as you type, previewed as chips; `"quoted"` disables parsing | Concrete plans remove the intrusion of open tasks (Masicampo & Baumeister 2011) |
| F-003 | Capture from anywhere | ⌃⌥Space Shortcut and `quickdo` CLI hit `POST /api/capture`; the CLI writes the file directly if the server is down | Capture in seconds |
| F-004 | Backlog vs Today + rollover | `scheduledFor` absent = Backlog; `!today`, `t`, ⌘Enter commit; morning rollover returns yesterday's leftovers to Backlog with a chip | Separate the master list from the daily commitment; plan only the next step |
| F-005 | Tiny Today (soft cap) | From item 6 the header goes amber "move one to tomorrow? (`T`)"; intent always wins | 3–5 item daily list |
| F-006 | Padded estimates | `~30m` is shown as `40m` everywhere; capacity uses padded minutes; "split?" hint above 90 min | Planning fallacy (Buehler, Griffin & Ross 1994) |
| F-007 | If-then cue | A block is a sufficient cue; other Today items get a cue via `c` or in the evening ritual; never prompted on the fast path | Implementation intentions (Gollwitzer & Sheeran 2006) |
| F-008 | Progress bar | Segment per committed Today item; label "3 done · 1 skipped · 1 left · 2 of 2 habits"; done items stay visible until midnight; 7-day sparkline | Progress principle (Amabile & Kramer 2011) |
| F-009 | Time blocks + timeline | `@9:00` places a block; vertical day column with anchors, calendar events, blocks, now-line, slack band; `[` `]` shift ±15 min, `+` extends | Time-blocking beats lists |
| F-010 | Capacity meter | Free minutes minus busy, slack and padded unblocked items; amber at 90 %, red over 100 % | A calendar has capacity, a list does not; 1–2 h slack |
| F-011 | Checkpoints | Auto midpoint on blocks ≥ 60 min, fires a reminder "halfway — on track? `x` done · `+` 15 more · `f` fallback" | Intermediate deadlines (Ariely & Wertenbroch 2002) |
| F-012 | Anchors + slack | `schedule.json` anchors (lectures, training) and a 90-min slack band; blocks never overlap anchors | Fixed anchors, flexible content (Polivy & Herman) |
| F-013 | Slip banner | At block start + grace with no start: banner on that row with `2` start · `o` on it · `n` next slot (moves only the next block) · `f` fallback · `T` tomorrow · `s` skip; at block end + grace: "still on it? `+` 15 min · `x` done" | Only the next block moves; never re-plan the day |
| F-014 | Self-forgiveness copy | "Skipped. One miss changes nothing; the next block is what counts." No red, no failure counters | Wohl, Pychyl & Bennett 2010; Sirois 2014 |
| F-015 | Fresh start | `.` sets `freshStartAt`: past-due items lose their block, stay on Today, and stop counting as slips; future blocks untouched; hint "next clean slate: 14:00 / tomorrow / Monday" after an unhandled slip | Fresh-start effect (Dai, Milkman & Riis 2014) |
| F-016 | Pre-planned fallback | Stored or derived "15 min at 16:00"; offered on the slip banner and auto-applied at `fallback.at` with a reminder if the slip is still unhandled | Pre-planned fallback; behavioural activation |
| F-017 | Two-minute start | `2` starts a 2-minute countdown on the row and records `started` | Any small action beats planning |
| F-018 | Habits + never miss twice | Habits strip; after a missed day the habit is pinned with "one miss is fine — do the 2-minute version today"; "5 of the last 7 days" instead of a streak | Lally et al. 2010 |
| F-019 | Evening ritual | Header button pulses from 20:00; `g e` enters ritual mode: pick 2–3 for tomorrow; Enter on a backlog row commits it and opens an inline cue field | Evening if-then planning |
| F-020 | Sunday review | Strip shown from Sunday until done: items rescheduled ≥ 3 times with `d` drop / `k` keep; week summary; archive runs with it | Weekly review; drop after 3 reschedules |
| F-021 | Tips | `tips.json` with `practice` and `source` per tip; rotates every 10 min and by context (slip, planning, capacity, review, habit); `?` shows keys, `Shift+?` shows sources | Tips with sources |
| F-022 | Agent transparency | Sync badge (synced / pending / offline / conflict / hermes last seen); toast "Hermes added N"; `suggestedFor` chip with `a`; "hermes ↗" link to the source | Trust in the agent channel |
| F-023 | Reminders | Server-scheduled SSE `reminder` → macOS notification from the PWA, or `osascript` when no window is open; per-kind opt-in | Cues fire at the time (Gollwitzer) |
| F-024 | Dock app + self-refresh | PWA install, launchd autostart, self-update to `stable` when idle, "update ready" pill | "An application that refreshes itself" |
| F-025 | Upcoming view | Next 7 days grouped by date + "later"; `p` cycles Backlog / Upcoming | "A schedule of things I want to do" |

## 8. Capture UX

**Grammar** (`src/domain/capture/parseCapture.ts`; order-independent tokens; everything unparsed is the title)

| Token | Result |
|---|---|
| `!today` `!tmr` `!mon`…`!sun` `!backlog` | `scheduledFor` (default without `!`: Backlog) |
| `!!` | Today + a block at the next free slot |
| `@9` `@9:30` `@tue 14:00` `@tomorrow 9` | `scheduledFor` + `block.start` (chrono-node, forward dates); before 09:00 today `@9` means today, after it means tomorrow |
| `~30m` `~1h` `~1h30` | `estimateMin` |
| `#thesis` / `+tag` | `project` / `tags` |
| `when …` / `if … then …` | `cue` (the rest of the line up to the next token; `if X then Y` splits cue and title) |
| `every day` / `every weekday` / `every mon` | `repeat` |
| `due fri` / `due 2026-09-30` | `due` |
| `"quoted text"` | literal |
| leading `?` | not a capture: live filter of Backlog/Upcoming |

Live chips under the bar: `Today · 09:00 · 40m padded · #thesis · when: I sit at the library`. `↑` recalls the last capture. A faint "start with a verb?" hint appears if the first word is a noun from a tiny stoplist; it never blocks.

**Focus model.** Two modes. *Capture mode* (bar focused; default on open and after every capture): typing, Enter, ⌘Enter, Esc, `↓` on an empty bar → list mode. *List mode* (one row highlighted): single-letter row keys; `/` or any unbound printable key → capture mode with the character inserted. Slip-banner actions are simply the row keys on the highlighted slipped row, so there is no third focus target.

**Keyboard map** (list mode): `j`/`k` move · `x` done · `u` undo · `s` skip · `t` Today · `T` tomorrow · `b` Backlog · `r` reschedule inline · `e` edit title · `c` cue · `@` block · `[` `]` shift block · `+` extend · `n` next free slot · `o` on it · `f` fallback · `.` fresh start · `2` two-minute start · `a` accept suggestion · `d` drop · `p` Backlog/Upcoming · `g e` ritual · `g r` review · `g s` sync · `?` help.

**Hotkey path.** A macOS Shortcut "Quick todo" (6 steps in `scripts/shortcuts/README.md`): Ask for Input → Get Contents of URL (`POST http://127.0.0.1:7777/api/capture`, JSON body, the two headers) → Show Notification with the parsed chips; assigned ⌃⌥Space. Also reachable by name from Spotlight. Raycast/Alfred are not installed, so no launcher script ships; the README shows the one-line `curl` for any launcher.

## 9. Schedule and calendar integration

**Timeline.** A vertical day column (day start to day end) in a right rail on wide windows, a compact strip below on narrow ones. Layers: anchors (grey), calendar events (grey, dotted, read-only), blocks (accent), now-line, slack band. One pure function `nextFreeSlot(from, minutes, busy[])` serves `!!`, `@`, `n`, `+` and `f`. The invariant asserted in three test files: **no action ever moves more than one block other than the one being placed, and anchors never move.** Events the app itself wrote are filtered out of the read path so a block is never counted twice.

**Phase A — read via ICS (M2, no OAuth).** You paste two URLs into `secrets.json`: Google → calendar settings → "Secret address in iCal format"; Outlook web → Settings → Calendar → Shared calendars → Publish → ICS link (the university tenant may have disabled publishing; then Outlook waits for Phase C). The server fetches every 15 min with `If-None-Match`, parses with `ical.js` (registers the feed's `VTIMEZONE`s, maps Windows time-zone ids like `W. Europe Standard Time` to IANA, expands recurrences including EXDATE and moved instances, ±14-day window), caches to `~/.cache/quickdo/calendar.json`. Honest freshness: provider feeds lag by minutes to hours, so ICS is a schedule-shape source, not a live view. The header shows "calendar as of 09:15".

**Phase B — write blocks to Google, one-way (M5).** Your setup (~15 min, once): Google Cloud Console → enable Calendar API → OAuth consent screen set to *In production* (Testing mode expires refresh tokens after 7 days) → OAuth client of type Desktop app → paste id/secret into `secrets.json`; create a calendar "Quickdo blocks" in the Google UI and paste its id. The server runs a loopback PKCE flow with scope `calendar.events` only; refresh token in the Keychain. One event per block; set/move/remove in Quickdo → insert/patch/delete (debounced 30 s); reconciliation at boot repairs duplicates. Reads are read-only: a block moved in Google shows a chip "moved in Google to 10:00 — `a` accept · `]` keep". Once this exists, the primary Google calendar is also read live through the API, and ICS stays only for Outlook.

**Phase C — Outlook / Microsoft 365 write (M5b, tenant-gated).** Step 0 is a 10-minute feasibility check: register a multi-tenant public-client app in a personal Entra tenant with the `http://localhost` redirect, then try one login against the university account requesting `Calendars.ReadWrite` + `offline_access`. If consent is blocked or a managed device is demanded, Outlook stays read-only via ICS and you can subscribe to the "Quickdo blocks" calendar there for viewing. If allowed: `@azure/msal-node` with auth-code + PKCE, same provider interface, same tests against an in-memory fake.

Rules for all phases: calendar events never become todos; calendar contents never enter a repo; the agent gets `schedule.json` anchors, not calendar data.

## 10. Testing strategy

**Pyramid** (all offline; the bottom layer has the most tests and runs in seconds)

| Layer | Tool | What it covers | What it catches |
|---|---|---|---|
| 1 Unit (domain) | Vitest + fast-check, ≥ 90 % line coverage on `src/domain` | `parseCapture.test.ts` (≥ 40 table-driven cases), `reducer.test.ts` (every action and precondition; invariants: unique ids, `rescheduleCount` monotonic, unknown fields preserved), `capacity`, `nextFreeSlot`, `slip`, `freshStart`, `habits`, `rituals`, `rollover`, `migrate` (`migrate ∘ migrate` is idempotent), `reminders.schedule` (fake clock), `tips` (every tip has a source), `reducer.property` (random action interleavings never throw; ingest is idempotent), `domain-purity` | Wrong parsing, broken transitions, day-rearranging bugs |
| 2 Contract | Vitest + Ajv | zod → JSON Schema parity with the committed `schema/*.json`; `test/fixtures/inbox/valid/*.json` all ingest to the expected items, `invalid/*.json` fail with the expected error path; the JSON fences in `docs/AGENT.md` validate; filename grammar; the synthetic-data allowlist over fixtures and docs | Contract drift between the app and Hermes |
| 3 Component | Vitest + jsdom + Testing Library | `CaptureBar` (chips, Enter clears, ⌘Enter, Esc, ↑ recall, draft on failure), `TodayList` (keys, amber cap header, rollover chip), `ProgressBar` (segments, label), `SlipBanner` (both states, keys dispatch the right calls), `Timeline`, `TipBar` (fake timers), `RitualStrip`, `ReviewStrip`, `SyncBadge`, `store` (SSE state replaces; optimistic add reconciled) | UI wiring that unit tests cannot see |
| 4 Server integration | Vitest + Hono `app.request()` + real `git` in a temp dir | `api.capture` (201, atomic write, history, SSE), `security` (missing header → 403, wrong `Host` → 421, `_test/clock` 404 without the flag), `sync.git` with a bare repo and "mac" + "hermes" clones: inbox file → ingested and pushed; concurrent pushes rebase cleanly with zero merge commits; a contract violation → RECOVERY with a `conflict/*` branch and Mac paths restored; push rejected 3× → backoff; unreachable remote → captures still persist and no conflict branch; 20 captures at 100 ms while the other clone pushes → all 20 present; `inbox.ingest` (rejected + error file, dedupe, stale `baseUpdatedAt`, size cap, bad filenames), `state.boot` (invalid file, missing file, migration), `ics` (Google and Outlook fixtures, Windows TZIDs, EXDATE, moved instance, all-day, DST day), `update` (idle + `stable` moved → exit 75; not idle → pill), `cli` | Git behaviour, durability, agent failure modes |
| 5 End-to-end | Playwright (Chromium), real server on a random port with a temp data dir, a throwaway bare repo, `pollSeconds=1`, and a controllable clock | `capture.spec` (focus without a click, type, Enter, row visible < 500 ms, file on disk, reload keeps it; a `POST /api/capture` from outside appears via SSE), `today.spec` (6th item stays with amber header; progress label; rollover after advancing the clock a day), `slip.spec` (banner after block start + grace; `n` moves exactly one other block; `.` leaves future blocks; auto-fallback at 16:00), `sync.spec` (an inbox file pushed from a second clone appears within 5 s), `ritual.spec`, `review.spec`, `pwa.spec` (manifest installable; `/api/*` never cached; server stopped → shell still loads and shows "server starting") | Flow-level and timing regressions |
| 6 Ops smoke | `quickdo doctor` + shell tests | node visible under launchd's PATH, plist loaded, port free, data repo reachable, secrets mode 600, no checkout under `~/Documents`; `run.sh` keeps the old `dist/` when a build fails | Environment breakage |

**The acceptance-checklist practice (your point 4).** `features.yaml` is the contract:

```yaml
- id: F-013
  title: Slip banner moves only the next block
  practice: slip recovery (Polivy & Herman)
  status: done            # planned | in-progress | done
  tests:
    - e2e/slip.spec.ts#[F-013] n moves only the next block
    - src/domain/plan/slip.test.ts#[F-013] at most one other block moves, anchors never
  manual:
    - "Reboot, log in, press ⌃⌥Space → notification with chips"   # [x] 2026-09-2x
```

`scripts/check-features.ts` runs in CI and as a pre-push hook: every `done` feature lists at least one test whose file exists, whose title appears in an `it(`/`test(` call, and which is not `.skip`/`.todo`; every `[F-0xx]` tag in any test maps to a known feature; `manual:` items of `done` features are ticked with a date; features whose tests already pass are printed as "ready to mark done". It renders `docs/ACCEPTANCE.md`, which is checked in and diff-reviewed in every PR. The rule of work per milestone: add the milestone's rows, write the acceptance tests first as `it.todo('[F-0xx] …')` so Vitest shows the red list, implement until the list is empty, tick the manual items, flip the status. Every bug fix starts with a failing test at the lowest layer that reproduces it.

**CI** (`.github/workflows/ci.yml` on the public repo, no secrets, ~6 min): `lint` (Biome + `tsc` incl. the domain project) → `unit` (domain + contract + component, coverage) → `server` (temp bare repos) → `e2e` (Playwright, traces on failure) → `features` → `privacy` (`check-no-pii.sh` + gitleaks + `npm audit --audit-level=high`) → `release` (on `main` only, after all green: `git push origin HEAD:stable`). Branch protection on `main` requires CI; squash merges. Locally: `npm test` (watch), `npm run test:all`, `npm run e2e`; pre-commit runs Biome and `vitest related`.

## 11. Build milestones

Each milestone: branch in a worktree off `main`, `features.yaml` rows + failing acceptance tests first, squash, PR with green CI, you merge, `release` moves `stable`, launchd picks it up. Estimates are raw → ×1.3 padded, by the plan's own rule.

| | Milestone | Deliverables | Definition of done | Days |
|---|---|---|---|---|
| **M0a** | Capture works in the browser | Both repos with initial commits; scaffold (Vite, Hono, Biome, Vitest, Playwright, CI skeleton, domain tsconfig); `parseCapture` (`! @ ~ # + "quoted" !! ?`), reducer (`add done undo skip reschedule rollover`), zod schemas + `migrate` v1, `Clock`; server with `security.ts`, `POST /api/capture`, item routes, `/api/state`, `/api/events`, `/api/health`, atomic writes into `~/quickdo-data` (git not yet wired); web: focus model, `CaptureBar` with chips, `TodayList`, `Backlog`, `ProgressBar`, `StartingBanner`, keys `/ Esc j k x u s t T b p ⌘Enter ?`; PWA manifest + icons + service worker; `features.yaml` seeded with F-001…F-025 | You capture in Chrome, tick things off, see the bar, reload and nothing is lost; CI green | 1 → 1.5 |
| **M0b** | Lives on the Dock | `install-launchd.sh` (absolute node path, logs dir), `run.sh` (exec only, no pull yet), `bin/quickdo` CLI with offline fallback, Shortcuts recipe, Chrome install → Dock, `doctor` basics, `docs/SETUP.md` | Capture from the Dock app, from ⌃⌥Space and from the terminal; the server survives a reboot | 0.5 → 1 |
| **M1** | The agent can write | git mutex + coalesced cycle with failure classes and backoff; inbox ingest (Ajv, grammar, dedupe, `baseUpdatedAt`, `rejected/`); RECOVERY; file watcher for hand edits; `SyncBadge`, agent toast, `suggestedFor` chip; `schema:build`; `docs/AGENT.md` = data-repo README; `check-no-pii.sh` + gitleaks + allowlist test. You create the PAT, add the knowledge-vault note, and hand-write one inbox file to prove the loop | An inbox file pushed by Hermes appears in the open window within 60 s in Backlog with a "hermes ↗" link; a malformed file lands in `rejected/` and shows a line in the UI; an offline hour produces zero conflict branches; the data repo's `git log` has zero merge commits | 1.5 → 2 |
| **M2** | Time has a shape | `schedule.json` anchors + `quickdo anchor`; `@` blocks; `Timeline`; capacity meter; soft Today cap; `Upcoming` + `p`; `[` `]` `+`; checkpoints; ICS read for Google + Outlook (Phase A) | You see lectures and calendar as grey blocks, place a block with `@`, see next week in Upcoming, and the meter turns amber when over capacity | 1.5 → 2 |
| **M3** | Slips, cues, rituals, reminders | Reminders (SSE + notification + `osascript` fallback); `c` cue + `when/if` syntax; `SlipBanner`; fresh start `.`; `2` two-minute start; habits + Habits strip + never-miss-twice; ritual mode `g e`; `ReviewStrip` + archive; self-forgiveness copy; `tips.json` + `TipBar` | A block that has not started shows the banner and a notification; `n` moves exactly one other block; a habit missed yesterday is pinned with kind copy; the fallback applies itself at 16:00; the evening ritual commits items with cues without touching the fast path | 2 → 2.5 |
| **M4** | It maintains itself | `update.ts` (idle check, exit 75), `run.sh` complete (ff-only pull, `dist.next` swap, keep old build on failure), `UpdatePill`, `release` CI job, branch protection, Dependabot, `doctor` complete, `SETUP.md` fresh-Mac install in 5 commands | A merged PR reaches the running app within 30 min of idleness with no action by you; a build that fails leaves the old app running and the pill says so | 1 → 1.5 |
| **M5** | Calendar write-back | Google one-way push (Phase B) with moved/removed chips and live primary-calendar reads; Outlook (Phase C) only if Step 0 passes | A block placed in Quickdo is on your phone's Google Calendar within 30 s; a block moved in Google shows the accept chip within 15 min | 1 → 1.5 (+1 → 1.5 Outlook) |

Order is strict M0a → M0b → M1 → M2 → M3; M4 and M5 can swap. Raw total 8.5 days → **padded about 11 focused days**, plus 1.5 optional for Outlook. M0a alone gives you a usable, tested app on day one.

## 12. Open questions (only the ones that change the work)

1. **Repo names** `quickdo` / `quickdo-data` (both free on your account). OK to create once you approve?
2. **Timezone and day window**: `Europe/Berlin`, 08:00–22:00? (config values; every test fixture uses them)
3. **Capture default = Backlog** (this plan), Today only with ⌘Enter or `!today`. Or default to Today?
4. **Chrome as the installed app host?** Safari's "Add to Dock" works but has no install prompt and suspends SSE more aggressively; the plan treats it as best-effort.
5. **May Hermes mark items `done`** (plan: yes, guarded by `baseUpdatedAt`), or only add and annotate?
6. **Does the university Microsoft 365 tenant allow publishing an ICS link?** Decides whether Outlook is readable in M2 or waits for the Phase C check.
7. **Node 22 LTS** via nvm (removes the Vitest 3 pin and every other engine constraint), or stay on 20.19?

## 13. Assumptions

- Node 20.19.5, npm 10, git 2.38, `gh` authenticated as `henrik253` with `repo` scope (verified); no Rust, no Raycast/Alfred; Chrome and Safari installed; macOS 15.6.
- You are fine with a ~40 MB Node process at login, macOS notifications from the app, and your todos in plaintext in a private GitHub repo (same trust model as `henrik253/knowledge`).
- Hermes can PUT files via the Contents API with a fine-grained PAT (it already does the equivalent on another private repo) and takes standing instructions from the knowledge vault.
- Production checkout at `~/quickdo` on branch `stable`; data clone at `~/quickdo-data`; development checkout wherever you like (e.g. `~/Documents/Informatik/myProjects/quickdo`), since only the launchd-run checkout must avoid `~/Documents`.
- Google Calendar is personal; Outlook is the university tenant; the "Quickdo blocks" calendar is never added as an ICS source.
- One machine writes.

## 14. What the detailed spec had that this plan cut, and why

The full workflow output (14,000 words, kept in `docs/reference/full-spec.md`) also specified: a write-ahead journal before every response, a `tombstones.json` file, separate `days/` and `weeks/` folders, a weekly `git push --mirror` backup, force-push recovery for remote history rewrites, a boot-health circuit breaker with automatic rollback after three crashes, a data-repo GitHub Action validating inbox files with `ajv-cli`, a schema-snapshot tripwire test, bats/shellcheck tests for shell scripts, axe accessibility tests, a p95 latency benchmark, and 36 numbered decisions. Each is defensible, and the sync tests and reminder rules there are worth consulting when we build M1 and M3. They were cut from the plan because each adds build time without changing what you experience in the first weeks, and the guiding rule is doing over planning. Any of them can be pulled back in as its own small PR when a real failure motivates it.
