# Quickdo — master plan (final)

Quickdo is a single-screen, keyboard-first todo app: an installed Chrome PWA on the Dock, served by a small local Node server (Hono) that launchd starts at login. One capture line with a quick syntax, a global hotkey (macOS Shortcut) and a CLI make appending a todo a two-second act. Data is plain JSON in a private git repo; the Mac server is the only writer of the canonical files, and the external agent (Hermes) only ever creates new command files in an inbox. The behavioural-science practices are the daily list's mechanics, not decorations — and none of them may add a step to the capture path. Testing is first-class: a feature checklist that CI cross-checks against real tests, plus a manual acceptance file for what cannot be automated. Milestone 0a (capture in the browser, tested, CI green) is usable after one working day.

## 1. Goals & non-goals

**Goals**

- Capture in seconds from anywhere: app window, ⌃⌥Space Shortcut, terminal. `POST /api/capture` p95 < 50 ms (bench); keydown → visible row < 500 ms in e2e (< 100 ms in practice).
- One screen, zero modals, every action one key or one token. **No follow-up prompts on the fast path** (`!today`, `t`, `@9`) — cues and fallbacks are asked for only in the evening ritual or on demand.
- The daily method built in: master backlog vs. a tiny Today list, if-then cues, ×1.3 padded estimates against real capacity, visible progress, time blocks with fixed anchors and slack, slip recovery that moves only the next block, fresh start as a clean slate (not a re-plan), never-miss-twice that fires after the *first* miss, evening ritual, Sunday review, sourced tips, reminders that actually fire.
- Data as human- and LLM-readable JSON in git; Hermes can add and annotate todos through GitHub; the open app shows agent changes within 60 s without any action by Henrik; the canonical file stays small (done items are archived).
- Runs as a Dock app, refreshes its own code from a CI-green ref, and rolls back by itself if the new build crashes.
- Tests at every layer, a `features.yaml` gate that fails CI when a feature is claimed without a passing test, and a checked-in manual acceptance list for the rest.
- No personal data ever in the public repo — enforced by scanners over code, docs, fixtures and tips.

**Non-goals** (explicitly out of scope; each is friction or planning-not-doing)

- Multi-machine concurrent editing (one Mac writes; a second machine is unsupported).
- Priorities, sub-tasks, project/tag browsers, drag-and-drop, mobile app, accounts, cloud hosting, dark-mode toggle (dark follows the OS).
- Calendar events becoming todos automatically.
- Publishing an ICS feed for calendars to subscribe to (12–24 h refresh makes blocks a day late).
- True two-way calendar sync (M5 is one-way push + read-only "moved in Google" chip; two-way is a later milestone with its cases enumerated first).
- Encryption of data at rest in git.
- Streak counters in the UI (a "5 of the last 7 days" consistency figure replaces them).

## 2. Decisions

| # | Decision | Choice | Why | Rejected alternative |
|---|---|---|---|---|
| D1 | Desktop shell | Installable PWA on top of a local Node server (launchd login agent) | Node 20 present, Dock icon for free, server can run git/hotkey endpoint/ICS fetch/reminders | Tauri (no Rust), Electron (200 MB, own updater), pure PWA (no git, no hotkey endpoint) |
| D2 | HTTP framework | Hono 4 + `@hono/node-server` 1 | `app.request()` in-process API tests without a port; built-in `streamSSE` | Fastify 5 |
| D3 | Project layout | One npm package: `src/domain`, `src/server`, `src/web` | Less scaffolding; one lockfile, one build, one test config | pnpm workspace |
| D4 | Repos | Public `henrik253/quickdo` (code) + private `henrik253/quickdo-data` (data) | Personal data cannot reach the public repo by construction; agent PAT never touches code; free CI minutes | Single private repo; encrypted public repo (LLM must read plaintext) |
| D5 | Storage shape | App-owned `todos.json` + `archive/`, `history/`, `days/`, `weeks/`, `tombstones.json`; agent-owned `inbox/*.json` | One live file Henrik and an LLM read at a glance; path ownership makes Mac↔agent textual conflicts impossible | Per-writer event logs + fold; per-item files |
| D6 | Agent write primitive | One new JSON file per command in `inbox/` via Contents API PUT, sequential, fixed filename grammar | No sha, no read-modify-write; a bad file hurts only itself; lexical order = time order | Appending to a shared JSONL; GitHub Issues → Action |
| D7 | Agent authority | Agent items always land in Backlog; agent may never set `status`, `scheduledFor`, `block`; may set `suggestedFor`; `update`/`done` on Henrik-edited fields require `baseUpdatedAt` | The daily commitment is Henrik's; stale agent snapshots must not overwrite his edits | Blind last-writer-wins patches |
| D8 | Today cap | **Soft, never redirects**: an explicit `!today`/⌘Enter/`t` always lands on Today; from item 6 the Today header turns amber with "6 on Today — move one to tomorrow? (`T` on a row)"; habits are excluded from the cap | Overriding stated intent breaks trust; the capacity meter already signals overload | Redirect the 6th to Backlog; hard block; inline "which one?" prompt |
| D9 | Conflict recovery | Source of truth = the `conflict/<ts>` branch (Mac-owned paths restored from it), not process memory; write-ahead journal with `lastCommittedSeq`; `recovery-in-progress` marker | Memory is lost on every restart; every Mac-owned path (not just `todos.json`) must be restored | Rewrite from memory only |
| D10 | Code self-update | Automatic when idle (no mutation for 2 min), only to `stable` (fast-forwarded by CI after green), build to `dist.next/` and swap, boot-health circuit breaker auto-rolls back after 3 crashes, `quickdo rollback` manual | CI green on Ubuntu ≠ boots on this Mac; the loop must heal itself | Pull `main` blindly; manual update only |
| D11 | Validation source of truth | zod 4 `z.toJSONSchema()` (draft 2020-12) → committed `schema/*.json` → `Ajv2020` + `ajv-formats` for agent files; `ajv-cli --spec=draft2020` in the data repo; parity + snapshot tests | One source for TS types, runtime checks and the agent contract; draft pinned so Ajv never throws on `$schema` | Hand-written JSON Schema; default draft-07 Ajv (throws on 2020-12) |
| D12 | Feature↔test gate | `features.yaml` with `file#test-title` references and `manual:` items rendered to `docs/ACCEPTANCE.md`; CI checks existence, non-skipped, ticked manual items | "Done" cannot be claimed without a real passing test or a ticked manual check | `// @feature` tags |
| D13 | Habits | Per-item `repeat`, listed in a separate **Habits strip** on Today, excluded from the cap and from day outcome; intervention fires on `missedYesterday`; UI shows "5 of the last 7 days", never a resettable streak | Lally et al.: one miss is harmless, the second is the one to prevent; a streak reset is a what-the-hell trigger | Pin after two misses; visible streak counter |
| D14 | Progress bar | Segment per committed Today item (filled done, hatched skipped, empty open); denominator = done + open + skipped; label "3 done · 1 skipped · 1 left · 2 of 2 habits" | Shows *which* items are done; skipping does not shorten the day | Minute-weighted; excluding skipped from the denominator |
| D15 | Timeline | Vertical day column, right rail ≥ 900 px, compact horizontal strip below | Matches the calendars Henrik uses | Horizontal only |
| D16 | Fresh start | `.` sets `freshStartAt`, drops `block` on past-due items (they stay on Today, unblocked, masked from slip detection); **future blocks never move** | Dai et al. is a psychological clean slate, not a re-plan; keeps the one-block invariant | Re-lay out remaining blocks |
| D17 | Sync cadence | 60 s `git ls-remote` pre-check + fetch only on change + sync on window focus/SSE connect; all git work through one mutex; port 7777 on 127.0.0.1 | Cheapest correct check; serialisation removes the Mac-races-itself failure | Webhooks; unserialised debounced commit/push |
| D18 | Google write scope | `calendar.events` only; Henrik creates "Quickdo blocks" once in the Google UI and pastes its id; one-way push | Smallest scope; two-way sync is the largest rework risk for the least payoff | Full `calendar` scope; two-way |
| D19 | Microsoft auth | Auth-code + PKCE with loopback redirect via `@azure/msal-node` `acquireTokenInteractive`; app registered multi-tenant in a personal Entra tenant; device-code only as fallback | Device-code is the most commonly blocked flow in university tenants; registration in the uni tenant is unnecessary | Device-code primary; uni-tenant registration |
| D20 | Data-repo validate Action | Yes, `paths: ['inbox/*.json']`, skipped for the Mac's `ingest:` commits, guarded for an empty glob; feedback channel for Hermes is `inbox/rejected/` (readable with `Contents: read`), the red X is for Henrik's email | Hermes cannot see check runs without `Checks: read`; rejected/ is the contract | Skip; rely on the red X |
| D21 | Web state / lint | zustand 5; Biome 2 (lint + format, `noRestrictedImports` patterns as a hint); domain purity enforced by `tsconfig.domain.json` (`types: []`, `lib: ["ES2022"]`) + `domain-purity.test.ts` | The type-checker is the real gate; Biome patterns alone miss modules | Biome 1.9 exact-path rule; ESLint + Prettier |
| D22 | Capture default | No `!` token → Backlog; ⌘Enter = Today; `!!` = Today + next free slot | Keeps the daily list tiny; the fast path is one modifier | Default to Today |
| D23 | Calendar cache | `~/.cache/quickdo/calendar.json` only, never in any repo; Hermes gets `schedule.json` anchors | Third-party calendar contents are personal data | Copy a window into the data repo |
| D24 | Idle definition | No **mutation** (`POST`/`PATCH`) in the last 2 min | SSE is permanently connected | "No request in 2 min" |
| D25 | Git serialisation | One async mutex (`p-queue`, concurrency 1) owns every git command and every `todos.json`/`schedule.json` write; cycle order: commit dirty → fetch → `rebase --autostash` → ingest → write → commit → push; polls coalesce | `git rebase` refuses a dirty tree and two git processes collide on `index.lock` | Independent debounced commit/push and poll |
| D26 | Watcher vs git | chokidar paused while the mutex is held; every server write records its hash and events with that hash are ignored; the server rewrites `todos.json` from memory as the last step of each cycle | Rebase/reset check out older files and would otherwise be adopted as hand edits | Separate sync worktree (more moving parts) |
| D27 | Failure classes | Network errors from `ls-remote`/`fetch`/`push` → offline badge + backoff to 5 min, no git state change; RECOVERY only when `rebase` fails after a successful fetch or the tree is corrupt; all git calls `timeout 15 s`, `GIT_TERMINAL_PROMPT=0` | Otherwise one offline train ride produces hundreds of `conflict/*` branches | "Any non-zero exit → RECOVERY" |
| D28 | Idempotency state | `tombstones.json` in the data repo (Mac-owned): `dedupeKey → {id, status, at}` written when an agent item is dropped/archived, never pruned; no machine-local `ingested-ids` | Dedupe must survive cache wipes and reinstalls; dropped items must not resurrect | `~/.cache/quickdo/ingested-ids.json` |
| D29 | Local state dir | `~/.local/state/quickdo/` for journal, watermarks, boot-failure counter, `built-sha`, backup mirror; `~/.cache/quickdo/` holds only the calendar cache | Cache dirs are disposable; correctness state is not | Everything under `~/.cache` |
| D30 | Loopback API hardening | Mutating routes require `Content-Type: application/json` and header `X-Quickdo-Client: 1`; `Host` must be `127.0.0.1:7777`; a present `Origin`/`Sec-Fetch-Site` must be same-origin; server binds `127.0.0.1` explicitly | Web pages can fire no-cors simple POSTs at loopback; DNS rebinding defeats Origin-only checks; a custom header forces a preflight that CORS-off rejects | Bearer token (see § 12 note) |
| D31 | Reminders | Server-side scheduler emits SSE `reminder` at block start, checkpoint, `fallback.at`, evening nudge, post-slip landmark; PWA shows a Notification; `osascript -e 'display notification'` when no client is connected; opt-in per kind | Blocks, checkpoints and fallbacks are decorative if nothing fires when the window is hidden | Visible-only UI |
| D32 | Focus model | Two modes: capture (bar focused) and list (row highlighted); `Esc`/`↓` from an empty bar → list; `/` → capture; unbound printable in list mode → capture with the char inserted; slip actions are row keys on the slipped row | "Always focused" and single-letter row keys cannot both hold; an implementer would improvise | Always-focused bar with modifier chords |
| D33 | Ritual mode | Explicit: `g e` or the header button (pulses after `eveningRitualAt`, never auto-switches); inside it `Enter` on a backlog row commits for tomorrow and opens an inline dashed cue field; `t` = Today always, `T` = tomorrow always | A key whose meaning flips with the wall clock is a mode error | `t` means tomorrow after 20:00 |
| D34 | Day rollover | `rollover {date}` on boot and on first activity after `dayStart`: open non-repeat items with `scheduledFor < today` → Backlog, `rescheduleCount++`, chip "N from yesterday moved to backlog (`t` = today)"; repeat items are due on every matching day | Re-committing each morning is the practice; stale dated items must not vanish | Silent carry-over |
| D35 | Stack line | Vite 7 · Vitest 3 · vite-plugin-pwa 1.x · Node 20.19 with `engines` + `engine-strict` + `.nvmrc`; every dependency major pinned | Consistent set that Node 20.19 satisfies; avoids Node-22-only majors (lint-staged 17, Vitest 5) | Vite 5 / Vitest 2 / pwa 0.20 (dead-end when Vite is bumped) |
| D36 | Service worker | `generateSW` precache + `navigateFallback` kept; `registerType: 'prompt'` via `useRegisterSW`, applied only when the capture bar is empty; `registration.update()` on `visibilitychange`, SSE `update`, and `/api/version` ≠ build sha | Precache is exactly what is wanted when the server is down; autoUpdate could reload mid-capture; browsers never check on their own in a window open for days | Separate offline page + `NetworkFirst` shell (unreachable behind the precache) + `autoUpdate` |

## 3. Architecture

```
┌────────────────────────────┐   HTTP + SSE    ┌───────────────────────────────────┐   git over HTTPS (gh credential helper)
│ Installed PWA              │ ◀─────────────▶ │ quickdo server (Node 20, Hono 4)  │ ◀───────────────────────────────────▶ GitHub
│ Chrome "Install app"       │ 127.0.0.1:7777  │ launchd login agent, KeepAlive     │        quickdo-data (private)
│ (Safari "Add to Dock"      │                 │ serves dist/web + /api/*           │                 ▲
│  best-effort)              │                 │ git mutex · reminders · ICS        │                 │ Contents API PUT inbox/<file>.json
│ React 18 + Vite 7 + zustand│                 └──────┬───────────┬────────────────┘                 │
└────────────────────────────┘                        │           │ chokidar (paused under mutex)     Hermes (external server, fine-grained PAT)
     ▲ Shortcut ⌃⌥Space / `bin/quickdo`               │           │
     │ → POST /api/capture                    ~/quickdo-data/   ~/.config/quickdo/      ~/.local/state/quickdo/     ~/.cache/quickdo/
                                              todos.json …      config.json,            journal.jsonl, built-sha,   calendar.json
                                                                secrets.json            boot-failures, backup.git
```

**Components**

- `src/domain/` — pure TypeScript, zero I/O, zero `node:`/`react`/DOM imports. Enforced by `tsconfig.domain.json` (`"types": []`, `"lib": ["ES2022"]`, project reference checked by `tsc --noEmit`) and `domain-purity.test.ts`. Modules: `capture/parseCapture.ts`, `state/reducer.ts`, `state/rollover.ts`, `plan/{capacity,busyUnion,nextFreeSlot,slip,freshStart}.ts`, `habits.ts` (consistency, `missedYesterday`, `missedTwice`), `rituals.ts` (evening, weekly, archive, prune), `outcomes.ts` (lazy day outcomes from history), `reminders/schedule.ts` (pure: state + clock → next reminder instants), `schema/{item,todos,inboxCommand,schedule,tombstones,migrate}.ts` (zod), `clock.ts` (`Clock { now(): Date; tz: string }` injected everywhere time matters), `tips.ts`.
- `src/server/` — Hono app: `index.ts` (boot: migrate → validate → replay journal → rollover → serve on `127.0.0.1`), `state.ts` (canonical in-memory state, atomic writes via tmp + rename, WAL journal with fsync before responding), `routes/{capture,items,day,state,events,sync,calendar,schedule,system,test}.ts`, `security.ts` (D30 middleware), `sync/{mutex,git,inbox,recovery,backup}.ts`, `reminders.ts`, `calendar/{ics,google,microsoft,provider}.ts`, `update.ts`, `watch.ts`. Bundled with esbuild into **one self-contained `dist/server.js`** (no runtime `node_modules`; `chokidar` 4, `simple-git`, `ical.js` are pure JS) — a broken `node_modules` can never affect the running server.
- `src/web/` — `main.tsx`, `App.tsx`, `store.ts` (zustand fed by `EventSource('/api/events')`, optimistic updates via the shared reducer), `focus.ts` (D32 mode machine), `components/{CaptureBar,TodayList,HabitsStrip,Backlog,Upcoming,ProgressBar,Timeline,SlipBanner,TipBar,RitualStrip,ReviewStrip,SyncBadge,UpdatePill,StartingBanner}.tsx`, plain CSS with variables (~300 lines). `vite-plugin-pwa` per D36; manifest: `name: "Quickdo"`, `short_name: "Quickdo"`, `theme_color`, `display: standalone`, `start_url: /`, icons `public/icons/{192,512,maskable-512}.png` generated from `icon.svg` by `scripts/icons.ts`. `NetworkOnly` for `/api/*`. `StartingBanner` shows "Quickdo server is starting… retrying" while `EventSource` errors and polls `/api/health` every 2 s — covers the seconds after login before launchd is up and every self-update restart. The build sha is baked in at build time and compared with `GET /api/version`.
- `bin/quickdo` — CLI: `quickdo "text"` → `POST /api/capture` (always `http://127.0.0.1:7777`, sends the D30 headers), prints the parsed chips; `quickdo anchor add "Lecture A" tue,thu 10:15-11:45` / `anchor rm "Lecture A"`; `quickdo rollback`; `quickdo auth google|microsoft`; `quickdo doctor`. If the server is down, capture and anchor commands write through the same domain code (`tsx`) and the server reconciles from disk on start.
- `bin/run.sh` — launchd entry point (see self-update). `bin/install-launchd.sh` renders `launchd/io.github.henrik253.quickdo.plist.template` with `NODE=$(command -v node)`, `EnvironmentVariables.PATH=$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, `EnvironmentVariables.QUICKDO_NODE=$NODE`, `WorkingDirectory=<production checkout>`, `RunAtLoad`, `KeepAlive`, `ThrottleInterval 5`, `StandardOutPath/StandardErrorPath` under `~/Library/Logs/quickdo/` (created with `mkdir -p` **before** bootstrap), loaded with `launchctl bootstrap gui/$(id -u) <plist>` and stopped with `launchctl bootout` (note: `launchctl kill` just respawns under `KeepAlive`). `run.sh` starts with `cd "$(dirname "$0")/.."` and execs `"$QUICKDO_NODE"`.
- `bin/doctor.ts` — checks: node/git/gh present under the plist's PATH (`launchctl print gui/$UID/io.github.henrik253.quickdo` and `node -v && npm -v` with that PATH), plist loaded, port 7777 free or ours, data repo clean and reachable (`git fetch` run via `launchctl`), `secrets.json` mode 600, neither checkout nor `dataDir` under `~/Documents`, `~/Desktop`, `~/Downloads` or iCloud Drive (TCC gives a silent EPERM to launchd agents), installed PWA `start_url` origin is `http://127.0.0.1:7777`, Hermes PAT expiry (`hermesPatExpires`) more than 14 days away, gitleaks/bats installed (warn).
- `scripts/` — `check-features.ts`, `check-no-pii.sh`, `schema-build.ts`, `schema-publish.ts`, `icons.ts`, `shortcuts/README.md` (the only hotkey recipe).

**Endpoints** (bound to `127.0.0.1` only; CORS off; D30 middleware on every `POST`/`PATCH`)

| Method + path | Body / result |
|---|---|
| `POST /api/capture` | `{ text, target?: "today" \| "backlog" \| "today+slot", source?: "ui"\|"hotkey"\|"cli" }` → `201 { item, tokens, warnings }` |
| `POST /api/items/:id/{done,undo,skip,drop,today,tomorrow,backlog,start,extend,accept,fallback,next}` | → `200 { state }` |
| `PATCH /api/items/:id` | partial item (title, note, cue, fallback, estimateMin, block, due, project, tags, repeat, order, checkpoint) |
| `POST /api/day/{freshStart,commit,review}` | fresh start now; evening commit `{ ids, cues }`; weekly review `{ dropped, kept }` |
| `GET /api/state` | full read model (items, habits, upcoming, schedule, today derived, consistency, capacity, reminders pending) |
| `GET /api/events` | SSE: `state`, `sync`, `agent` (`{ added, changed: [{id, field}] }`), `reminder`, `update`, `tip`; stream ends on `c.req.raw.signal` abort |
| `POST /api/sync` · `GET /api/sync/status` | force sync (coalesced); `{ lastSync, remoteSha, pending, rejectedCount, conflict, offline, hermesLastSeen }` |
| `GET /api/calendar?date=` · `POST /api/calendar/refresh` | cached events for a day; refetch ICS |
| `GET /api/schedule` · `PUT /api/schedule/anchors` | anchors (validated through zod) |
| `GET /api/health` · `GET /api/version` · `POST /api/update/restart` | liveness; running git sha + build sha; apply pending update now |
| `POST /api/_test/clock` | `{ now }` sets the server `Clock`; exists only when `QUICKDO_TEST_CLOCK=1`, otherwise 404 (covered by `security.test.ts`) |

**Self-refresh, two kinds**

1. *Data.* Every 60 s (and on SSE connect and `POST /api/sync` fired on `visibilitychange`), a coalesced cycle inside the git mutex (§ 6). Hermes push → visible ≤ 60 s while the Mac is awake; on wake the first poll catches up.
2. *Code.* Production runs a dedicated clean checkout `~/quickdo` on branch `stable`; development happens in worktrees elsewhere. `bin/run.sh` (every step best-effort; the final `exec` always runs on whatever `dist/` exists):
   - If `rollback-reason.txt` exists and `origin/stable` still equals the rolled-back sha → skip pull/build.
   - If `git status --porcelain` is empty: `git pull --ff-only origin stable` (else log "dirty tree, update refused").
   - `npm ci` only if `package-lock.json` changed since `built-sha`; build into `dist.next/` only if `HEAD != built-sha`; on any failure: log, keep `dist/`, leave `built-sha` unchanged (HEAD ≠ built-sha triggers a clean retry next start; `npm ci` is idempotent).
   - Swap: `rm -rf dist.prev; mv dist dist.prev; mv dist.next dist`.
   - Boot-health circuit breaker: record start time; `exec "$QUICKDO_NODE" dist/server.js` under a wrapper that increments `~/.local/state/quickdo/boot-failures` when the server exits non-zero within 20 s; at 3 consecutive failures swap `dist.prev` back, pin `built-sha` to the previous sha, write `rollback-reason.txt`, and the server shows it in `UpdatePill` ("rolled back to <sha>: crashed 3×"). `built-sha` is written only after `/api/health` has answered; the counter resets after 60 s of health. `dist.prev` is kept until the new build has survived that window.
   - The server checks `git ls-remote origin stable` every 30 min; if it moved and the server is idle (D24) it drains the push queue and exits with code 75; `KeepAlive` restarts it through `run.sh`. Not idle → `UpdatePill` "update ready — restart" (`POST /api/update/restart`). The web app calls `registration.update()` on the SSE `update` event and on version mismatch; the new shell is applied on the next moment the capture bar is empty.

**Stack (every major pinned; `engines.node: "20.19.x"`, `.npmrc engine-strict=true`, `.nvmrc`, CI uses `node-version-file`):** Node 20.19 · npm 10 · TypeScript 5 · React 18 · Vite 7 · vite-plugin-pwa 1 · zustand 5 · Hono 4 · @hono/node-server 1 · p-queue 8 · simple-git 3 · chokidar 4 · zod 4 · ajv 8 (`ajv/dist/2020`) + ajv-formats 3 · ajv-cli 5 (data-repo Action) · chrono-node 2 · ulid 3 · ical.js 2 · windows-iana 5 · date-fns 4 + `@date-fns/tz` 1 · esbuild 0.24 · tsx 4 · Vitest 3 · fast-check 3 · @testing-library/react 16 + user-event 14 · @playwright/test 1 (Chromium) · @axe-core/playwright 4 · Biome 2 · knip 5 · lint-staged 16 · simple-git-hooks 2 · gitleaks (brew; CI via `gitleaks/gitleaks-action@v2`) · bats-core (brew) · GitHub Actions. Dependabot ignores majors that raise `engines.node`. Deliberately absent: Tailwind, UI kits, Redux, Express, Electron, Tauri, `googleapis` SDK (plain `fetch` + PKCE), Raycast (not installed).

## 4. Repositories, privacy & secrets

| Repo | Visibility | Contents | Writers |
|---|---|---|---|
| `henrik253/quickdo` | public, MIT | code, tests, `tips.json`, `docs/SOURCES.md`, generated `schema/*.json`, docs, `config.example.json`, CI | Henrik / Claude Code via PR |
| `henrik253/quickdo-data` | private | `todos.json`, `schedule.json`, `tombstones.json`, `archive/`, `days/`, `weeks/`, `history/`, `inbox/`, `schema/` copy, `README.md` (agent contract), `.gitignore`, `.github/workflows/validate.yml` | Mac server (everything except `inbox/*.json` creation); Hermes (`inbox/` new files only) |

Created with `gh repo create henrik253/quickdo --public --clone` and `gh repo create henrik253/quickdo-data --private`; the data repo gets an initial commit (`README.md`, `schema/`, `.gitignore`, `inbox/.keep`, `history/.keep`, `archive/.keep`, empty `todos.json`, empty `tombstones.json`) before Hermes is pointed at it.

**Where personal data and secrets live (never in `quickdo`)**

- `~/quickdo-data/` — clone of the private repo (not under `~/Documents`).
- `~/.config/quickdo/config.json` — `{ "dataDir": "~/quickdo-data", "port": 7777, "timezone": "Europe/Berlin", "dayStart": "08:00", "dayEnd": "22:00", "slackMinutes": 90, "eveningRitualAt": "20:00", "todayCap": 5, "slipGraceMin": 10, "defaultEstimateMin": 30, "pollSeconds": 60, "reminders": { "blockStart": true, "checkpoint": true, "fallback": true, "evening": true, "landmark": true }, "hermesPatExpires": "2027-09-01" }`.
- `~/.config/quickdo/secrets.json` (600) — `{ "ics": [{ "name": "Personal", "url": "…" }, { "name": "Uni", "url": "…", "anchorTitleMatch": "^Lecture" }], "google": { "clientId", "clientSecret", "calendarId" }, "microsoft": { "clientId" } }`. ICS URLs are bearer secrets. The example file states that the "Quickdo blocks" calendar must never be added as an ICS source.
- OAuth refresh tokens — login Keychain via `security add-generic-password -s quickdo -a google|microsoft` (read with `security find-generic-password -w`); fallback to `~/.config/quickdo/tokens/*.json` (600) only if Keychain access fails under launchd (doctor warns).
- `~/.local/state/quickdo/` — `journal.jsonl` (WAL), `lastCommittedSeq`, `built-sha`, `boot-failures`, `rollback-reason.txt`, `recovery-in-progress`, `backup.git` (weekly `git push --mirror` of the data repo). `~/.cache/quickdo/calendar.json` — the only cache. Neither is ever in a repo.
- Hermes's credential: fine-grained PAT, repository `quickdo-data` only, permissions `Contents: read & write`, `Metadata: read`, 1-year expiry, stored on Hermes's server like his existing PATs; its expiry date goes into `config.json` so doctor and `SyncBadge` warn 14 days ahead. Henrik creates it; the plan never handles the value. **The PAT cannot be scoped to a path**; RECOVERY, not GitHub, enforces the contract (§ 6).
- The Mac's push credential: existing `gh auth setup-git` credential helper (keychain, readable by login agents once the user is logged in).

**Guardrails in the public repo**

- `.gitignore`: `.env*`, `*.local.json`, `data/`, `secrets/`, `tokens/`, `*.ics`, `playwright-report/`, `test-results/`, `dist*/`.
- `scripts/check-no-pii.sh` (CI job `privacy` + pre-commit): generic shapes only — `calendar.google.com/calendar/ical`, `outlook.office365.com/owa`, `private-[0-9a-f]{32}`, `ghp_`, `github_pat_`, any absolute path under `/Users/`, any `@` email outside `example.com`. Additionally, if `~/.config/quickdo/pii-denylist.txt` exists (gitignored, local only: other private repo names, the university name, real calendar names) its lines are also grepped — real identifiers are caught locally but never appear in the public guard. `scripts/check-no-pii.test.sh` (bats) feeds known-bad inputs and expects failure.
- `gitleaks` in CI (hard gate) and pre-commit (skips with a warning when `command -v gitleaks` fails).
- `test/allowlist.test.ts`: scans `test/fixtures/**`, `docs/**/*.md` (including every JSON fence), `config.example.json`, `tips.json`, `features.yaml`, and this plan's examples; only names from `{alice, bob, example, "Water the fern", "Read paper X", "Lecture A", "Lecture B", "Training"}`, no `@` sign, no `https://` outside `example.com`.
- Every example in docs, the agent contract and this plan is synthetic (see § 5). CI artefact retention 7 days; screenshots are synthetic by construction.
- Integration tests create bare repos in `os.tmpdir()`; nothing personal is ever committed as test data.

## 5. Data model

**Files in `quickdo-data/`**

```
todos.json                 live state (open + recently finished) — written ONLY by the Mac server
archive/2026-09.json       done items > 14 days and dropped items > 30 days, moved by the Sunday job (Mac only, append-only per month)
tombstones.json            dedupeKey → { id, status, at } for agent items that were dropped/archived (Mac only, never pruned)
schedule.json              fixed anchors, day bounds, slack, anchorFromCalendar rules (Mac only; Hermes may read)
days/2026-09-18.json       per-day: freshStartAt, eveningRitualDone, outcome (Mac only)
weeks/2026-W38.json        { weeklyReviewDone, reviewedAt } (Mac only)
history/2026-09.jsonl      append-only event log, one file per month, kept forever (Mac only)
inbox/                     one JSON command per file; Hermes creates, Mac consumes + deletes
inbox/rejected/            invalid commands + <name>.error.txt (Mac writes; Hermes reads; pruned after 30 days)
schema/*.schema.json       copied from the code repo by `npm run schema:publish`; README states the `version` they correspond to
README.md                  the agent contract (identical to docs/AGENT.md)
.gitignore                 *.tmp, .DS_Store, *~, *.swp
.github/workflows/validate.yml   ajv-cli over inbox/*.json (§ 10)
```

**Item — every field**

| Field | Type | Notes |
|---|---|---|
| `id` | ULID | assigned by the Mac on ingest/capture; agent never sets ids |
| `title` | string 1–200 | the action; parser strips syntax tokens |
| `note` | string ≤ 5 000? | markdown allowed; rendered escaped only |
| `status` | `open` \| `done` \| `skipped` \| `dropped` | repeat items stay `open`; their per-day outcome lives in history |
| `scheduledFor` | `YYYY-MM-DD`? | present ⇒ on that day's list (Today or Upcoming); absent ⇒ backlog — **the master/daily split** |
| `suggestedFor` | `YYYY-MM-DD`? | agent's suggestion; chip with one-key accept (`a`), never auto-applied |
| `block` | `{ start: "HH:MM", minutes }`? | time block on `scheduledFor`; a block counts as a sufficient cue |
| `estimateMin` | int? | raw; UI always shows `padded = ceil((estimateMin ?? defaultEstimateMin) × 1.3 / 5) × 5` (derived, never stored) |
| `cue` | string? | implementation intention: "when I sit down at the library at 9"; asked for only in the evening ritual or via `c` |
| `fallback` | `{ title?, minutes, at? }`? | when absent, `{ minutes: 15, at: "16:00" }` is *derived* and surfaced only when a slip happens |
| `project` | string? | from `#thesis` |
| `tags` | string[] | from `+tag`; default `[]` |
| `due` | `YYYY-MM-DD`? | hard deadline, distinct from `scheduledFor` |
| `repeat` | `daily` \| `weekdays` \| `weekly:mon`…`weekly:sun`? | habit items (Habits strip) |
| `checkpoint` | `"HH:MM"`? | intermediate checkpoint on blocks ≥ 60 min (auto midpoint, editable); fires a reminder |
| `rescheduleCount` | int | +1 on every move of `scheduledFor` to a later day or to backlog, including rollover; ≥ 3 flags for Sunday review |
| `order` | int | manual position within its list; new Backlog items get `min − 1` (top), new Today items `max + 1` (end) |
| `source` | `{ kind: "ui"\|"hotkey"\|"cli"\|"agent", by?, ref?, dedupeKey? }` | `ref` = URL; `dedupeKey` makes agent adds idempotent |
| `createdAt`, `updatedAt` | ISO 8601 with offset | `updatedAt` is the agent's optimistic-concurrency token |
| `completedAt`, `skippedOn`, `droppedAt` | ISO? | set with the matching status |

Calendar dates and wall-clock times are in `config.timezone`; instants are ISO with offset. Unknown fields are preserved on read (`.passthrough()`).

**`todos.json` example (synthetic; M3 shape)**

```json
{
  "$schema": "./schema/todos.schema.json",
  "version": 3,
  "updatedAt": "2026-09-18T09:12:03+02:00",
  "items": [
    {
      "id": "01K5G3ZQ8H0000000000000001",
      "title": "Read paper X, section 3",
      "note": "",
      "status": "open",
      "scheduledFor": "2026-09-18",
      "block": { "start": "09:00", "minutes": 40 },
      "estimateMin": 30,
      "cue": "when I sit down at the library at 9",
      "fallback": { "title": "skim abstract + figures", "minutes": 15, "at": "16:00" },
      "project": "example",
      "tags": [],
      "checkpoint": null,
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
      "project": "example",
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

**Item JSON Schema** (`schema/item.schema.json`, generated from `src/domain/schema/item.ts` with `z.toJSONSchema(item, { target: "draft-2020-12" })`; abridged only in `description` strings)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/henrik253/quickdo/schema/item.schema.json",
  "type": "object",
  "required": ["id", "title", "status", "tags", "rescheduleCount", "order", "source", "createdAt", "updatedAt"],
  "properties": {
    "id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
    "note": { "type": "string", "maxLength": 5000 },
    "status": { "enum": ["open", "done", "skipped", "dropped"] },
    "scheduledFor": { "type": "string", "format": "date" },
    "suggestedFor": { "type": "string", "format": "date" },
    "block": { "type": "object", "required": ["start", "minutes"], "additionalProperties": false,
               "properties": { "start": { "type": "string", "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$" }, "minutes": { "type": "integer", "minimum": 5, "maximum": 720 } } },
    "estimateMin": { "type": "integer", "minimum": 1, "maximum": 1440 },
    "cue": { "type": "string", "maxLength": 200 },
    "fallback": { "type": "object", "required": ["minutes"], "additionalProperties": false,
                  "properties": { "title": { "type": "string", "maxLength": 200 }, "minutes": { "type": "integer", "minimum": 2, "maximum": 120 }, "at": { "type": "string", "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$" } } },
    "project": { "type": "string", "maxLength": 50 },
    "tags": { "type": "array", "items": { "type": "string", "maxLength": 30 }, "maxItems": 20 },
    "due": { "type": "string", "format": "date" },
    "repeat": { "type": "string", "pattern": "^(daily|weekdays|weekly:(mon|tue|wed|thu|fri|sat|sun))$" },
    "checkpoint": { "type": ["string", "null"], "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$" },
    "rescheduleCount": { "type": "integer", "minimum": 0 },
    "order": { "type": "integer" },
    "source": { "type": "object", "required": ["kind"],
                "properties": { "kind": { "enum": ["ui", "hotkey", "cli", "agent"] }, "by": { "type": "string", "maxLength": 40 },
                                "ref": { "type": "string", "format": "uri", "maxLength": 500 }, "dedupeKey": { "type": "string", "maxLength": 100 } } },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "completedAt": { "type": "string", "format": "date-time" },
    "skippedOn": { "type": "string", "format": "date" },
    "droppedAt": { "type": "string", "format": "date-time" }
  }
}
```

**`schedule.json`** (synthetic)

```json
{ "version": 1, "dayStart": "08:00", "dayEnd": "22:00", "slackMinutes": 90,
  "anchors": [ { "name": "Training", "days": ["mon", "wed", "fri"], "start": "17:00", "end": "18:15" } ],
  "anchorFromCalendar": [ { "calendar": "Uni", "titleMatch": "^Lecture" } ] }
```

Anchors are recurring commitments **not present in any connected calendar**; recurring calendar events can be promoted to anchors by rule instead of being maintained twice. Capacity always unions busy intervals (anchors ∪ calendar ∪ blocks) before subtracting, so an overlap is never double-counted regardless of source. Anchors are edited via `quickdo anchor add|rm` or `PUT /api/schedule/anchors`; `schedule.json` is watched like `todos.json` (hand edit → validate → reload, red bar on invalid).

**`days/2026-09-18.json`**: `{ "date": "2026-09-18", "freshStartAt": "14:00" | null, "eveningRitualDone": false, "outcome": "hit" | "miss" | "rest" | null }`. Outcome is computed **lazily and idempotently** from history on the first poll after the date changes (and on boot), never by a midnight timer: ≥ 1 committed non-habit item done ⇒ `hit`; committed items existed, none done, and the app was opened that day ⇒ `miss`; nothing committed, or the app was never opened ⇒ `rest`. Habits do not affect the outcome. Used only for the week strip (neutral hollow dots for `miss`, never red) and the Sunday review.

**`tombstones.json`**: `{ "version": 1, "byDedupeKey": { "issue-1-reply": { "id": "01K5…", "status": "dropped", "at": "2026-10-01T…" } } }`.

**Migrations** (`src/domain/schema/migrate.ts`): an ordered list of pure `(fileV_n) → fileV_{n+1}` steps. On boot: migrate → validate → write back once → commit `migrate: v2→v3`. `version` is bumped whenever `schema-snapshot.test.ts` changes; the data-repo `README.md` states which `version` its `schema/` corresponds to. Planned bumps: v1 (M0: base), v2 (M2: `block`, `checkpoint`, `fallback`), v3 (M3: `repeat`, `days/`, `weeks/`).

**Boot** (`state.ts`): if `todos.json` fails zod after migration, it is kept as `todos.json.invalid-<ts>`, `git show HEAD:todos.json` is loaded instead, the red bar shows "todos.json invalid at line N (kept as …)", and the server serves — never a crash loop. If the file is missing on an empty repo, an empty state is created. Then the WAL journal entries with `seq > lastCommittedSeq` are replayed, then `rollover(today)`.

**History** (`history/2026-09.jsonl`, Mac-only writer): `{"ts", "type": "added|done|undone|skipped|started|extended|rescheduled|dropped|fallback|fresh_start|committed|ingested|rejected|ping|archived|migrated", "itemId"?, "day", "from"?, "to"?, "reason"?: "rollover", "by"?: "hermes", "auto"?: true, "scope"?: "next_block_only"}`.

**State transitions** (`src/domain/state/reducer.ts`; every action is a pure `(state, action, clock) → state`; an action whose precondition fails returns the state unchanged **and** a `warning` the UI shows as a chip — never a silent no-op)

| Action | Precondition | Effect |
|---|---|---|
| `add` | — | new item, `status: open`; Backlog (order = min − 1) unless `scheduledFor` given (order = max + 1); history `added` |
| `done` | `status ∈ {open, skipped}` | non-repeat: `status: done`, `completedAt`; repeat: status unchanged, history `done {day}`; item stays visible in "Done today" |
| `undo` | `status ∈ {done, skipped}` or repeat done today | back to `open`, clears timestamps; history `undone` |
| `skip` | `open` | `status: skipped`, `skippedOn`; stays in the progress denominator; repeat: history `skipped {day}` only |
| `start` | on Today | history `started` (used by slip detection and the 2-minute timer) |
| `extend {minutes}` | has `block` | `block.minutes += 15`; if that overlaps the next block, only that block moves by the overlap |
| `reschedule {to}` | not `dropped` | `scheduledFor = to` (or removed for backlog); `rescheduleCount++` when moving later or to backlog; block cleared; history `rescheduled` |
| `rollover {date}` | — | open non-repeat items with `scheduledFor < date` → Backlog, `rescheduleCount++`, history `rescheduled {reason: rollover}`; returns the count for the chip |
| `setBlock {start, minutes}` | `scheduledFor` set | sets `block`; `checkpoint` auto = midpoint if `minutes ≥ 60` and unset |
| `slipNext {id}` | item slipped | `block.start = nextFreeSlot(now, padded)`; if that overlaps the next block, only that block moves by the overlap — `scope: "next_block_only"` is the only scope the reducer accepts |
| `applyFallback {auto?}` | item slipped | block replaced by the (stored or derived) fallback at `fallback.at` or next free slot; history `fallback {auto}` |
| `freshStart` | — | `day.freshStartAt = now`; past-due items lose their `block` (stay on Today, unblocked, masked from slip detection); **future blocks untouched**; history `fresh_start` |
| `accept {id}` | has `suggestedFor` | `scheduledFor = suggestedFor`, clears `suggestedFor` |
| `drop` | not `done` | `status: dropped`, `droppedAt`; hidden; agent items write a tombstone |
| `commitEvening {ids, cues}` | — | `scheduledFor = tomorrow` and `cue` per id; nudge copy at 4+; `day.eveningRitualDone` |
| `reviewWeek {dropped, kept}` | — | drops listed ids; `weeks/<W>.weeklyReviewDone = true` |
| `archive {before}` | Sunday job | moves `done` items with `completedAt` older than 14 days and `dropped` older than 30 days into `archive/YYYY-MM.json`; tombstones for agent items; history `archived` |
| `ingest {command}` | valid inbox command | `add` (backlog only, `suggestedFor` allowed), `update` (whitelisted fields, `baseUpdatedAt` rules), `done` (`baseUpdatedAt` rule), `ping` (history only); dedupe by `dedupeKey` against items, then tombstones |

**Derived, never stored**: `padded`; `busy(day) = union(anchors ∪ calendar(non-all-day) ∪ blocks)`; `free = dayEnd − max(now, dayStart, freshStartAt)`; `used = |busy ∩ [max(now,dayStart), dayEnd]| + slack + Σ padded(unblocked open Today non-habit items)`; `capacity = free − used` (amber at 90 %, red over 100 %); `notStarted(item, now)` = block start + grace passed, no `started`/`done` event today; `overran(item, now)` = block end + grace passed and item was started but not done; both masked by `freshStartAt`; `consistency(habit)` = done days / due days over the last 7 (and 30) due days; `missedYesterday`, `missedTwice` from `done` events over the habit's due days; progress: committed Today items (done, open, skipped) + habits due today reported separately; `upcoming` = items with `scheduledFor` in the next 7 days grouped by date, plus "later"; day outcomes (§ above).

## 6. Sync protocol with the external agent

**Invariant: one writer per path.** `todos.json`, `archive/`, `tombstones.json`, `schedule.json`, `days/`, `weeks/`, `history/`, `schema/`, `README.md` — Mac only. `inbox/*.json` — created only by external writers, deleted or moved to `inbox/rejected/` only by the Mac. Nobody edits a file it does not own, so a rebase never produces a textual conflict between the Mac and the agent. The Mac racing itself is prevented by the mutex (D25).

**Hermes side (the contract, `docs/AGENT.md` = `quickdo-data/README.md`; worked examples in `test/fixtures/inbox/valid/`)**

1. Optionally read state: `GET /repos/henrik253/quickdo-data/contents/todos.json` with `Accept: application/vnd.github.raw+json` (works above 1 MB); `schedule.json` for anchors; `inbox/rejected/` for feedback on its own mistakes; `tombstones.json` to learn which of its items Henrik dropped.
2. Write one command per file, **PUTs sequential, never parallel**: `PUT /repos/henrik253/quickdo-data/contents/inbox/<name>` with `{ "message": "hermes: add <title>", "content": base64(json) }`. Filename grammar (enforced by schema, ingest and `validate.yml`): `^\d{8}T\d{9}Z-[a-z0-9-]{1,40}\.json$` (UTC, milliseconds, e.g. `20260918T070300123Z-reply-alice.json`). On `409` re-PUT the same file; on `422 "sha" wasn't supplied` for a filename you generated, treat it as already applied. ≤ 20 files per burst; file ≤ 32 KB.
3. Command shape (`schema/inbox-command.schema.json`, `additionalProperties: false` everywhere):
   ```json
   { "v": 1, "op": "add", "by": "hermes", "at": "2026-09-18T07:03:00Z",
     "item": { "title": "Reply to alice about the meeting slot", "note": "Thread from 17 Sep", "estimateMin": 10,
               "due": "2026-09-19", "suggestedFor": "2026-09-18", "project": "example", "tags": ["mail"],
               "cue": "after checking mail in the morning", "ref": "https://example.com/issues/1",
               "dedupeKey": "issue-1-reply" } }
   ```
   `op ∈ add | update | done | ping`. `add`: `title` required; the item always lands in Backlog. `update`: `id` or `dedupeKey` + `patch` restricted to `title, note, due, estimateMin, project, tags, cue, suggestedFor, ref`; **`baseUpdatedAt` (the item's `updatedAt` the agent read) is required when the patch touches `title`, `note`, `cue`, `due` or `estimateMin`**; blind patches are allowed only for agent-owned annotations (`ref`, `suggestedFor`, `tags` as a union). `done`: `id` or `dedupeKey` + `baseUpdatedAt`; never applied when a newer `undone` event exists. `ping`: heartbeat, at most once a day, ingested as a history line. **The agent can never set `status`, `scheduledFor` or `block`.** Validate locally against the schema before pushing; `at` must be within ±7 days of now.
4. Never touch any Mac-owned path. Never invent ids. Never modify or delete an existing inbox file (a consumed file is gone; re-sending with the same `dedupeKey` is a safe no-op; a tombstoned key is a no-op for `add` and `gone` for `update`/`done`).
5. Feedback: ingested items appear in `todos.json` with `source.by = "hermes"`; rejected files land in `inbox/rejected/<name>.json` + `<name>.error.txt` with the Ajv/semantic error (`stale: item changed at <ts>`, `gone`, `not_found`, `schema: <path>`); history carries `ingested`/`rejected`/`ping` events; `SyncBadge` shows "hermes last seen <date>" and turns amber after 7 days of silence.

**Knowledge-vault pointer (M1 deliverable, written by Henrik from the template in `docs/AGENT.md`)**: a short note in `henrik253/knowledge` telling Hermes the data repo exists, the PAT name, the inbox convention, "never touch todos.json", and where the worked examples are.

**Mac side (`src/server/sync/`)** — everything below runs inside the single mutex; a poll that finds a cycle queued returns immediately (coalescing).

```
cycle (every 60 s; on SSE connect; on POST /api/sync from visibilitychange; immediately after a cycle that left files in inbox/):
  pause watcher
  if dirty (todos.json / schedule.json / days / weeks / history / tombstones): git add <explicit paths> && git commit "ui: …"
  remoteSha = git ls-remote --heads origin main            (timeout 15 s, GIT_TERMINAL_PROMPT=0)
    network error → badge offline, backoff 5 s → 5 min, resume watcher, return       # NOT recovery
  if remoteSha == knownRemoteSha and nothing unpushed and inbox/ (non-recursive, excluding rejected/) is empty: resume watcher, return
  git fetch origin                                          network error → as above
  if !(git merge-base --is-ancestor knownRemoteSha origin/main): history rewrite → CONTRACT VIOLATION path (below)
  git rebase --autostash origin/main                        non-zero → RECOVERY
  ingest, looping until inbox/ is empty or 2 s budget spent (then schedule an immediate follow-up cycle):
    for each entry directly under inbox/ (lstat: regular file, ≤ 32 KB, name matches grammar; anything else → rejected/ via git mv, error "not_a_command_file")
    JSON parse, strip control chars, Ajv2020 strict allErrors (not verbose) → semantic checks
    pass 1: all `add` (dedupe: items by dedupeKey, then tombstones) ; pass 2: `update`/`done`/`ping`
      (target must exist — a miss is retried once next cycle in memory, then rejected `not_found`; baseUpdatedAt mismatch → `stale`; tombstone → `gone`)
    valid   → reducer.ingest → git rm inbox/<file>
    invalid → git mv inbox/<file> inbox/rejected/<file>; write <file>.error.txt
  if state changed: write todos.json (tmp + rename), append history/tombstones, git add <explicit paths>, commit "ingest: 2 from hermes (1 rejected)"
  git push (non-fast-forward → fetch, rebase, push; 3 tries then backoff)   network error → offline badge, commits accumulate
  on success: knownRemoteSha = pushed sha; truncate journal; lastCommittedSeq = current
  final: rewrite todos.json from memory if the on-disk hash differs, record hash, resume watcher
  SSE state + sync + agent { added: [...], changed: [{ id, field }] }   → toast "Hermes added 2 · changed title on 1"

local mutation (POST /api/capture, /api/items/:id/*, PATCH, PUT schedule):
  append journal line (fsync) → apply to memory → write file atomically (under the mutex) → append history → respond (< 10 ms)
  debounce 3 s  → enqueue "commit" ; debounce 15 s → enqueue "push"   (both run as a cycle; offline: commits accumulate, SyncBadge "offline (3 pending)")
```

**RECOVERY** (rebase failure after a successful fetch, or corrupt tree): write `recovery-in-progress`; `git rebase --abort`; `git branch conflict/<ISO-ts> HEAD` (nothing is ever lost); `git reset --hard origin/main`; **`git checkout conflict/<ts> -- todos.json archive tombstones.json schedule.json days weeks history schema README.md`** (every Mac-owned path comes from our branch, so a Hermes commit that edited `schedule.json` or truncated a history file is undone); take `inbox/` from origin; replay journal entries > `lastCommittedSeq`; re-run ingest; commit `resolve: restore Mac-owned paths after conflict`; push; delete the marker; SSE `sync { conflict: true, branch }`; history `rejected { kind: "contract_violation", paths }` if the agent touched a Mac-owned path. On boot with the marker present, the procedure is finished from the `conflict/*` branch before serving. **CONTRACT VIOLATION (history rewrite)**: same restore from the local branch, then `git push --force-with-lease`. Weekly `git push --mirror ~/.local/state/quickdo/backup.git`. `conflict/*` branches older than 90 days and `inbox/rejected/*` older than 30 days are pruned by the Sunday job.

**Hand edits:** chokidar watches `todos.json` and `schedule.json` outside mutex hold; if the on-disk hash differs from the last recorded server write, the file is re-parsed and validated; valid ⇒ becomes the new memory state and is committed as `edit: <file>`; invalid ⇒ red bar "…invalid at line N", memory state kept.

**Validation gates:** every inbox file → Ajv2020 + formats; `todos.json` on load → migrate + zod; `schema/*.json` regenerated by `npm run schema:build` (CI fails when stale) and copied by `npm run schema:publish`; `test/schema-snapshot.test.ts` fails on any schema change until the snapshot and `version` are intentionally updated.

**Latency budget:** Hermes push → visible in the PWA ≤ 60 s awake; ≤ 1 s after window focus.

## 7. Features mapped to best practices

| ID | Feature | Behaviour | Practice + citation |
|---|---|---|---|
| F-001 | Capture bar | Bar at the top; focused on open and after every capture; Enter appends, input clears, row flashes 200 ms; failed capture keeps text as a `localStorage` draft with a "retry" row | Capture everything — Allen, *Getting Things Done* (2001) |
| F-002 | Quick syntax + live chips | Tokens parsed as typed; chips preview under the bar; `"quoted"` disables parsing | Fast capture (Allen); concrete plans remove intrusion — Masicampo & Baumeister 2011 |
| F-003 | Capture from anywhere | `POST /api/capture` via macOS Shortcut ⌃⌥Space and `bin/quickdo`; CLI writes the file directly if the server is down | Capture in seconds (Allen) |
| F-004 | Backlog vs Today + rollover | `scheduledFor` absent = backlog; `!today`, `t`, ⌘Enter commit; agent items only ever land in Backlog; morning rollover moves yesterday's leftovers back to Backlog with a chip | Separate master backlog from daily commitment; plan only the next step — Masicampo & Baumeister 2011 |
| F-005 | Tiny Today (soft) | From item 6 the header goes amber "6 on Today — move one to tomorrow? (`T`)"; explicit intent always wins; habits excluded | 3–5 item daily list |
| F-006 | Padded estimates | `~30m` shown as `40m` everywhere; no estimate ⇒ `defaultEstimateMin`; capacity uses padded minutes; "split?" hint above 90 min | Planning fallacy — Buehler, Griffin & Ross 1994 |
| F-007 | If-then cue | A block is a sufficient cue; unblocked Today items may get a cue via `c` or in the evening ritual (inline dashed field, Enter saves, Esc leaves empty); no prompt on the fast path; cue-less indicator only inside ritual mode | Implementation intentions — Gollwitzer & Sheeran 2006 |
| F-008 | Progress bar | Segment per committed Today item (filled/hatched/empty); label "3 done · 1 skipped · 1 left · 2 of 2 habits"; done items stay visible until midnight; 7-day sparkline from history | Progress principle — Amabile & Kramer 2011 |
| F-009 | Time blocks + timeline | `@9:00` places a block; vertical column with anchors (grey), calendar events (grey, dotted), blocks (accent), now-line, slack band; `[`/`]` shift ±15 min; `+` extend 15 min | Time-blocking beats lists |
| F-010 | Capacity meter | `free − used` with unioned busy intervals (§ 5); amber at 90 %, red over 100 % with "move one to tomorrow? (`T`)" | Calendar has capacity, a list doesn't; 1–2 h slack |
| F-011 | Checkpoints | Auto midpoint on blocks ≥ 60 min; **fires a reminder** "halfway through 'Read paper X' — on track? `x` done · `+` 15 more · `f` fallback" | Intermediate deadlines — Ariely & Wertenbroch 2002 |
| F-012 | Anchors + slack | `schedule.json` anchors (CLI-editable, hot-reloaded) and `anchorFromCalendar` rules; 90 min slack band; blocks never overlap anchors | Fixed anchors, flexible content — Polivy & Herman (what-the-hell effect) |
| F-013 | Slip banner | `notStarted` at block start + grace: banner on that row with `2` start · `o` on it · `n` next slot (moves only the next block) · `f` fallback · `T` tomorrow · `s` skip; `overran` at end + grace: quiet line "still on it? `+` 15 min · `x` done"; earliest slip only; never re-plans the day | Only the next block moves — Polivy & Herman |
| F-014 | Self-forgiveness copy | "Skipped. One miss changes nothing; the next block is what counts." No red, no failure counters, neutral miss dots | Wohl, Pychyl & Bennett 2010; Sirois 2014 |
| F-015 | Fresh start | `.` sets `freshStartAt`, unblocks past-due items, masks them from slips, leaves future blocks alone; hint "next clean slate: 14:00 / tomorrow / Monday / 1 Oct" appears only after a `notStarted` slip left unhandled ≥ 1 h | Fresh-start effect — Dai, Milkman & Riis 2014 |
| F-016 | Pre-planned fallback | `>` token or `fallback` field, else derived "15 min at 16:00"; surfaced on the slip banner (`f`) and **auto-applied at `fallback.at`** with a reminder if the slip is still unhandled; history `fallback {auto: true}` | Pre-planned fallback; behavioural activation |
| F-017 | Two-minute start | `2` starts a 2-minute countdown on the highlighted row and records `started` | Behavioural activation — any small action beats planning |
| F-018 | Habits + never miss twice | Habits strip; on `missedYesterday` the habit is pinned to the top with "one miss is fine — do the 2-minute version today"; on `missedTwice` self-compassion copy and the fallback size becomes the default; "5 of the last 7 days" instead of a streak | Lally et al. 2010 |
| F-019 | Evening ritual | Header button pulses from `eveningRitualAt`; `g e` enters ritual mode: "pick 2–3 for tomorrow"; `Enter` on a backlog row commits for tomorrow and opens the inline cue field; nudge at 4+; Esc leaves ritual mode | Evening if-then planning; plan only the next step |
| F-020 | Sunday review | `ReviewStrip` shown from Sunday until `weeklyReviewDone` (so a missed Sunday shows it Monday): items with `rescheduleCount ≥ 3` with `d` drop / `k` keep; week done count; consistency table; outcome dots; archive + prune run with it | Weekly review; drop after 3 reschedules |
| F-021 | Tips | `tips.json` (Appendix A, each with `practice` + `source`); rotates on load and every 10 min; contextual groups (slip, planning, capacity, review, habit); `?` keyboard help; `Shift+?` sources | Show tips with sources |
| F-022 | Agent transparency | `SyncBadge` (synced 14:02 / pending / offline / conflict / hermes last seen); toast "Hermes added N · changed <field>"; "hermes ↗" link to `source.ref`; `suggestedFor` chip with `a`; rejected-file line | Trust in the agent channel |
| F-023 | Keyboard-only | Full map with an explicit focus model (§ 8); no mouse required | Fast use, zero planning overhead |
| F-024 | Dock app + self-refresh | PWA installable (icons, manifest, SW); `StartingBanner`; launchd autostart; self-update to `stable` when idle; auto-rollback; `UpdatePill` | "App on my computer that refreshes itself" |
| F-025 | Upcoming view | Next 7 days grouped by date + "later"; `p` cycles Backlog / Upcoming; `r`, `t`, `T` work there | Schedule of things I want to do |
| F-026 | Reminders | Server-scheduled SSE `reminder` → macOS notification (PWA) or `osascript` when no client is connected; kinds opt-in | Cues fire at the time/place — Gollwitzer & Sheeran 2006 |
| F-027 | Backlog filter | Typing `?` as the first character of the bar filters Backlog/Upcoming live on title/project/tags; Esc clears | Fast retrieval, more doing |
| F-028 | Miss-day nudge | Morning after a `miss` day: one line "yesterday was a miss — pick one small thing (`2` starts a 2-minute timer)" | Never miss twice; behavioural activation |

## 8. Capture UX spec

**Grammar** (`src/domain/capture/parseCapture.ts`; input `text, clock`; output `{ item: Partial<Item>, tokens: Token[], warnings: string[] }`; hand-written tokenizer over whitespace-separated tokens; order-independent; everything unparsed is the title)

| Token | Result |
|---|---|
| `!today` `!tmr` `!mon`…`!sun` `!backlog` | `scheduledFor` (default without `!`: backlog) |
| `!!` | `scheduledFor = today` + `block` at `nextFreeSlot(now, padded)` |
| `@9` `@9:30` `@tue 14:00` `@tomorrow 9` | `scheduledFor` + `block.start` via chrono-node (`forwardDate: true`); `minutes = padded(estimateMin ?? defaultEstimateMin)` |
| `~30m` `~1h` `~1h30` `~1.5h` | `estimateMin` |
| `#thesis` | `project` (first `#`); further `#x` → `tags` |
| `+tag` | `tags` |
| `when …` / `if …` (rest of line up to the next token) | `cue`; `if <cue> then <action>` splits cue and title |
| `after lunch:` / `in library:` prefix | `cue` |
| `> 15m at 16:00` / `> skim abstract` | `fallback` |
| `every day` / `every weekday` / `every mon` | `repeat` |
| `due fri` / `due 2026-09-30` | `due` |
| `"quoted text"` | literal, no token parsing inside |
| leading `?` | not a capture: live filter (F-027) |
| remaining words | `title`; a faint "start with a verb?" hint if the first word is in a tiny noun stoplist (never blocks) |

Live chips under the bar: `Today · 09:00 · 40m padded · #thesis · when: I sit at the library`. `Esc` clears; `↑` recalls the last capture. Ambiguity rules: `@9` before 09:00 today = today 09:00, after = tomorrow 09:00; `!mon` = next Monday (today if Monday and before `dayEnd`). Landing: new Today item at the end of Today, new Backlog item at the top of Backlog; both flash.

**Focus model** (`src/web/focus.ts`, D32)

| State | Keys |
|---|---|
| **Capture mode** (bar focused; default on open, after every capture, on window focus if the bar was last focused) | typing; `Enter` capture; `⌘Enter` capture to Today; `Esc` clear (empty bar: → list mode); `↓` on an empty bar → list mode; `↑` recall |
| **List mode** (one row highlighted; the earliest slipped row is highlighted first when a slip exists) | single-letter row keys below; `/` → capture mode; any unbound printable key → capture mode with that character inserted; `Esc` → capture mode |
| **Ritual mode** (`g e`; a layer over list mode) | `Enter` on a backlog row commits for tomorrow and opens the inline cue field; `Esc` leaves ritual mode |

Slip-banner actions are just the row keys on the highlighted slipped row — no separate focus target and no key overloads. Tested in `focus.test.ts`, `CaptureBar.test.tsx`, `TodayList.test.tsx` and the e2e case "type immediately after opening, then Esc, j/k/x without clicking".

**Hotkey path**

- macOS Shortcut "Quick todo" (`scripts/shortcuts/README.md`, 6 steps): *Ask for Input* → *Get Contents of URL* `POST http://127.0.0.1:7777/api/capture` with headers `Content-Type: application/json`, `X-Quickdo-Client: 1`, JSON `{ "text": "<input>", "source": "hotkey" }` → *Show Notification* with the returned title and chips; assign ⌃⌥Space in the shortcut's details (no conflict on this Mac: the input-source symbolic hotkeys are disabled). Notes in the README: the global shortcut is honoured only after Shortcuts.app has been opened once post-login (the SETUP check is "press ⌃⌥Space after a reboot"); it does not fire while a full-screen app captures the keyboard; the Shortcut is also reachable by name from Spotlight. Target: hotkey press to notification < 3 s including typing.
- `bin/quickdo "read paper X !today ~30m"` from the terminal; offline fallback writes through the domain reducer.
- Raycast/Alfred are not installed; no script is shipped (one paragraph in the README shows the curl line for any launcher).

**Keyboard map** (list mode unless noted)

`/` focus capture · `Enter` (capture mode) capture · `⌘Enter` capture to Today · `j`/`k` move · `x` or `Enter` done · `u` undo · `s` skip · `t` to Today (always) · `T` to tomorrow (always) · `b` to backlog · `r` reschedule inline (`mon`, `+2`, `backlog`) · `e` edit title inline · `c` set cue · `@` set block · `[` `]` shift block ±15 min · `+` extend 15 min · `n` next free slot (slipped/blocked row only) · `o` on it (dismiss slip) · `f` fallback · `.` fresh start · `2` two-minute start · `a` accept `suggestedFor` · `d` drop · `p` cycle Backlog / Upcoming · `g e` ritual mode · `g r` review strip · `g s` force sync · `?` help · `Shift+?` tip sources.

Latency: keydown → optimistic row (shared reducer) → server ack; e2e budget 500 ms on CI, `capture.bench.ts` asserts `POST /api/capture` p95 < 50 ms.

## 9. Schedule & calendar integration

**Timeline (`Timeline.tsx`, `src/domain/plan/`)** — vertical column `dayStart`–`dayEnd` in a right rail ≥ 900 px, compact strip below. Layers: anchors, calendar events (read-only; all-day events ignored for capacity, per-calendar toggle), blocks, now-line, past shading from `freshStartAt`, slack band at the end. Header line: "calendar as of ~09:15 (feed)". `nextFreeSlot(from, minutes, busy[])` is the pure function used by `!!`, `@`, `n`, `+` and `f`; it never moves any block except the one being placed and, on overlap, the single next block. The shared invariant, asserted once in `slip.test.ts`, `freshStart.test.ts` and `nextFreeSlot.test.ts`: **no action ever moves more than one block other than the one being placed, and anchors never move.** `Timeline.tsx` needs only `CalendarEvent { id, calendar, title, start, end, allDay }` — providers are a server concern. Events carrying the app's own marker (`quickdoId` extended property, or the app's UID pattern in ICS) are filtered out of the read path so blocks are never counted twice.

**Phase A — read via ICS (M2, ~1 day, no OAuth).** Henrik pastes two URLs into `secrets.json` (Google: calendar settings → "Secret address in iCal format"; Outlook web: Settings → Calendar → Shared calendars → Publish → ICS link). `src/server/calendar/ics.ts` fetches every 15 min (with `If-None-Match`/`If-Modified-Since`; 304 skips parsing) and on `POST /api/calendar/refresh`; parses with `ical.js`: register every `VTIMEZONE` from the feed in `ICAL.TimezoneService`, map Windows TZIDs (`W. Europe Standard Time`) to IANA via `windows-iana`, default unknown TZIDs to `config.timezone` with a logged warning; expand recurrences via `ICAL.Event` with exceptions related (EXDATE, RECURRENCE-ID overrides, `STATUS:CANCELLED`), bounded to a ±14-day window; keep the window in `~/.cache/quickdo/calendar.json`; serve `GET /api/calendar?date=`. Fetcher takes an injectable `fetch`. Failures are non-fatal: the last cache stays, `SyncBadge` shows "calendar stale since 09:15". Freshness expectation is stated honestly: provider feeds lag by minutes to hours, so ICS is a schedule-shape source, not a live view; once Phase B exists, the primary Google calendar is read live via the API and ICS stays only for Outlook. If the university tenant blocks publishing, Outlook stays out until Phase C.

**Phase B — write blocks to Google, one-way (M5).** Henrik's manual setup (~15 min): Google Cloud Console → project → enable Calendar API → OAuth consent screen (External; set *In production* to avoid the 7-day Testing-mode refresh-token expiry) → OAuth client type Desktop app → paste `clientId`/`clientSecret` into `secrets.json`; create a calendar "Quickdo blocks" in the Google UI and paste its id. `src/server/calendar/google.ts`: loopback PKCE flow (`GET /oauth/google/start`, callback `http://127.0.0.1:7777/oauth/google/callback`), scope `calendar.events`, plain `fetch`, refresh token in the Keychain. Mapping: one event per block, `extendedProperties.private.quickdoId = item.id`; block set/moved/removed in Quickdo ⇒ event insert/patch/delete (debounced 30 s); reconciliation at boot repairs missing/duplicate events by `quickdoId`. Reads (`events.list` with `syncToken`, every 15 min) are **read-only**: if an event's time differs from its block, a chip "moved in Google to 10:00 — `a` accept · `]` keep" goes through the normal `setBlock` path so the one-block invariant holds; an event deleted in Google shows "removed in Google — `a` unblock · `]` re-create". Primary-calendar events are read live via the same token for the Timeline. "Reconnect Google" button appears on `invalid_grant` (Google also revokes tokens after ~6 months of non-use).

**Phase C — Outlook / M365 write (M5b, tenant-gated).** Step 0 (~10 min): (1) register a multi-tenant public-client app in Henrik's own free Entra tenant with the `http://localhost` redirect on the "Mobile and desktop applications" platform; (2) attempt one login from this Mac requesting delegated `Calendars.ReadWrite` + `offline_access` against the university account (Graph Explorer or the MSAL sample). If user consent is disabled, Conditional Access demands a managed device, or no token issues, Phase C is dropped and Outlook stays ICS-read-only (Henrik can subscribe the "Quickdo blocks" ICS in Outlook for viewing). If allowed: `@azure/msal-node` `acquireTokenInteractive` (auth-code + PKCE, loopback), device-code only as fallback, a "Quickdo blocks" calendar, `singleValueExtendedProperties` carries the id, `/me/calendarView` delta queries for read-only chips. `calendar/provider.ts` interface with two implementations, tested once against an in-memory fake.

Rules for all phases: calendar events never become todos; calendar contents never enter a repo; the agent gets `schedule.json` anchors, not calendar data; the app's own events never enter the read path.

## 10. Testing strategy

**Pyramid** (bottom = most tests, fastest; all offline)

| Layer | Tool | Location | Catches |
|---|---|---|---|
| 1 Unit (domain, ≥ 90 % line coverage enforced) | Vitest 3 + fast-check | `src/domain/**/*.test.ts`: `parseCapture.test.ts` (≥ 40 table-driven cases: every token, quoted text, `!!`, `if…then`, evening/morning `@9` rule, `?` filter prefix, DST 2026-10-25), `reducer.test.ts` (every action incl. `rollover`, `start`, `extend`, `accept`, `archive`; invariants: ids unique, `rescheduleCount` monotonic, done items keep `scheduledFor`, unknown fields preserved, only `next_block_only` accepted, failed preconditions return a warning, habits excluded from cap and outcome, ritual accepts up to the cap), `capacity.test.ts` (table-driven: blocked + unblocked items, no estimate, anchor/calendar overlap unioned, past block after fresh start, `free` definition), `nextFreeSlot.test.ts`, `slip.test.ts` (`notStarted` vs `overran`, grace, auto-fallback at `fallback.at`, landmark hint only after ≥ 1 h, shared one-block invariant), `freshStart.test.ts` (future blocks untouched, shared invariant), `habits.test.ts` (daily/weekdays/weekly, `missedYesterday` fires the pin, `missedTwice` defaults fallback, consistency never resets, DST), `outcomes.test.ts` (lazy, idempotent, never-opened = rest), `rituals.test.ts` (drop candidates ≥ 3, nudge at 4+, archive 14/30 days, prune, `weeklyReviewDone` persistence, archival never changes Today/consistency views — property), `migrate.test.ts` (a fixture per historical version; `migrate ∘ migrate` idempotent — property), `reminders.schedule.test.ts` (fake clock: next instants for block start, checkpoint, fallback, evening, landmark; opt-in kinds), `tips.test.ts` (every tip has a non-empty `source`; every `practice` in `features.yaml` appears on ≥ 1 tip), `reducer.property.test.ts` (random action/command interleavings never throw; ingest idempotent), `domain-purity.test.ts` + `tsc -p tsconfig.domain.json` | Wrong parsing, broken transitions, day-rearranging bugs |
| 2 Contract | Vitest + Ajv2020 | `test/contract/schema-parity.test.ts` (zod → JSON Schema equals committed files, draft pinned to 2020-12), `schema-snapshot.test.ts` (tripwire, also asserts `version` bumped), `inbox-fixtures.test.ts` (`test/fixtures/inbox/valid/*.json` all pass and ingest to expected items; `invalid/*.json` fail with the expected error path; stale update rejected, matching update applied, blind `ref` patch applied, tombstone → `gone`, `ping`), `filename-grammar.test.ts`, `agent-doc.test.ts` (JSON fences in `docs/AGENT.md` extracted and validated), `allowlist.test.ts` | Contract drift between app and Hermes |
| 3 Component | Vitest + jsdom + RTL + user-event | `src/web/components/*.test.tsx` + `focus.test.ts`: `CaptureBar` (chips, Enter clears, ⌘Enter target, Esc, ↑ recall, draft on failure, `?` filter), `TodayList` (keys, soft-cap amber header, done section, rollover chip, inline cue field in ritual mode only), `HabitsStrip`, `Backlog`/`Upcoming` (landing positions, filter, `p` cycle), `ProgressBar` (segments, hatched, label), `SlipBanner` (both states, keys dispatch the right calls, fallback default when `missedYesterday`), `Timeline` (capacity colours), `TipBar` (fake timers, context groups), `RitualStrip`, `ReviewStrip`, `SyncBadge` (offline/conflict/hermes last seen), `UpdatePill` (rollback reason), `StartingBanner`, `store.test.ts` (SSE `state` replaces; optimistic add reconciled; `reminder` → Notification call) | UI wiring that unit tests cannot see |
| 4 Server integration | Vitest + Hono `app.request()` + real `git` in `os.tmpdir()` | `test/server/api.capture.test.ts` (201, atomic write, journal before response, history, SSE first event via read-one-chunk-then-cancel with abort handling), `capture.bench.ts` (p95 < 50 ms), `security.test.ts` (text/plain POST → 415, missing `X-Quickdo-Client` → 403, foreign `Host` → 421, foreign `Origin` → 403, `_test/clock` 404 without the env flag), `sync.git.test.ts` (bare repo + "mac" and "hermes" clones: (a) hermes adds inbox file → ingested, deleted, pushed; (b) concurrent pushes rebase cleanly, zero merge commits; (c) forced contract violation on `schedule.json` + deleted history file → RECOVERY, `conflict/*` branch exists, both restored, journal replayed; (d) push rejected 3× → backoff then success; (e) unreachable remote → captures still persist; (f) remote at a closed port for 5 cycles then restored → no `conflict/*` branch, one push, badge offline→synced; (g) 20 captures at 100 ms intervals while a second clone pushes an inbox file → zero conflict branches, zero merge commits, all 20 items in the pushed file; (h) SIGKILL at three points inside RECOVERY → same final state after boot; (i) remote history rewrite → restore + force-with-lease), `inbox.ingest.test.ts` (rejected + error.txt, dedupe vs tombstones, 70 files across cycles, 32 KB cap, symlink/subdir refused, filename grammar, two-pass ordering, retry-once, `at` window, control chars), `watch.test.ts` (hand edit reload for both files; invalid keeps memory; a real rebase that checks out an older `todos.json` leaves memory unchanged and creates no `edit:` commit), `state.boot.test.ts` (invalid file, missing file, empty repo, migration write-back, journal replay, recovery marker), `ics.test.ts` (fixtures: Google export, Outlook export with Windows TZID with and without VTIMEZONE, EXDATE, RECURRENCE-ID moved instance, cancelled instance, all-day, DST 2026-10-25, 304 handling), `reminders.test.ts` (fake clock; SSE emitted; osascript stub called when no client), `update.test.ts` (idle + `stable` moved ⇒ exit 75; not idle ⇒ pill; dirty tree ⇒ refused), `cli.test.ts` (spawns `bin/quickdo` against in-process server; offline fallback writes the file; `anchor add/rm`), `provider.test.ts` (fake calendar provider: mapping, debounce, own events never enter `calendar.json`, moved-in-Google chip path, dead-token `invalid_grant` → Reconnect) | Git behaviour, file durability, agent failure modes |
| 5 End-to-end | Playwright Chromium; `webServer` boots the real server on a random port with `QUICKDO_HOME=<tmp>`, a throwaway bare repo, `pollSeconds=1`, `QUICKDO_TEST_CLOCK=1`; a fixture sets both `page.clock` and `POST /api/_test/clock` | `e2e/capture.spec.ts` (focus without click, type, Enter, row < 500 ms, file on disk, reload keeps it; `request.post('/api/capture')` appears via SSE without reload; Esc → j/k/x without clicking), `today.spec.ts` (6th item stays on Today with amber header; progress label; rollover chip after advancing the clock a day; Upcoming shows a `!mon` item), `slip.spec.ts` (clock past block start + grace → banner; `n` moves exactly one other block; `.` leaves future blocks; checkpoint reminder event; auto-fallback at 16:00), `sync.spec.ts` (push inbox file from a second clone → "hermes ↗" row within 5 s), `ritual.spec.ts` (`g e`, Enter commits with inline cue; `t` never means tomorrow), `review.spec.ts` (strip persists to Monday until done), `pwa.spec.ts` (manifest installability: icons, `display`, SW controls `/`; `/api/*` never cached; server stopped → shell loads from precache and shows `StartingBanner`; version mismatch triggers `registration.update()`), `a11y.spec.ts` (axe: no serious violations), screenshots at 1280 and 400 px | Flow-level and timing regressions |
| 6 Ops smoke | `bin/doctor.ts`; bats for `bin/run.sh` (`shellcheck` + dry run with stub node: rebuild only when sha changed, refuse on dirty tree, `dist.prev` replaced not nested, `npm ci` failure keeps `dist/` and still execs, crash-3× rollback + reason file + no rebuild until `stable` moves, `built-sha` written only after health); `scripts/check-features.test.ts`, `scripts/check-no-pii.test.sh` (known-bad inputs must fail) | Environment breakage; broken guards |

**Acceptance checklist practice (Henrik's point 4)**

`features.yaml` is the contract:

```yaml
- id: F-013
  title: Slip banner moves only the next block
  practice: what-the-hell effect / slip recovery
  status: done            # planned | in-progress | done
  tests:
    - e2e/slip.spec.ts#[F-013] n moves only the next block
    - src/domain/plan/slip.test.ts#[F-013] anchors unchanged, at most one other block moved
- id: F-024
  title: Dock app + self-refresh
  practice: app on my computer that refreshes itself
  status: done
  tests:
    - test/server/update.test.ts#[F-024] idle and stable moved exits 75
    - test/ops/run.bats#[F-024] crash 3x rolls back
  manual:
    - "Install from Chrome menu → icon appears in the Dock"          # [x] 2026-09-2x
    - "Reboot, log in, press ⌃⌥Space → notification with chips"     # [x] 2026-09-2x
```

`scripts/check-features.ts` (CI job `features`, pre-push hook): every `done` feature lists ≥ 1 test whose file exists, whose title appears in a `test(`/`it(` call in that file, and which is not `.todo`/`.skip`; every `manual:` item of a `done` feature is ticked with a date; every `[F-0xx]` tag in any test maps to a known feature; `planned`/`in-progress` features whose referenced tests already pass are printed as "ready to mark done"; it renders `docs/ACCEPTANCE.md` (checked in, diff-reviewed in the PR). The rule of work per milestone: append the milestone's rows to `features.yaml`, write the acceptance tests first as `it.todo('[F-0xx] …')` so vitest shows the red list, implement until `todo === 0` for those ids, tick the manual items, then flip `status: done`. Every bug fix starts with a failing test in the lowest layer that reproduces it, tagged with the affected feature.

**CI** (`.github/workflows/ci.yml`, public repo, no secrets; Node from `.nvmrc`, npm cache; ~6 min)

Jobs on push/PR: `lint` (Biome + `tsc --noEmit` incl. `tsconfig.domain.json` + knip) → `unit` (domain + contract + component, coverage artefact) → `server` (git configured on the runner, temp bare repos) → `e2e` (Playwright with browser cache; traces on failure, retention 7 days) → `ops` (bats + shellcheck + guard-script tests) → `features` → `privacy` (`check-no-pii.sh` + `gitleaks-action` + `npm audit --audit-level=high`) → `release` (on `main` only, after all green: `git push origin HEAD:stable`). Branch protection on `main`: CI required, squash merges. Dependabot weekly (ignoring majors that raise `engines.node`). `quickdo-data/.github/workflows/validate.yml`: on push with `paths: ['inbox/*.json']` and `if: "!startsWith(github.event.head_commit.message, 'ingest:')"`, checkout `henrik253/quickdo@stable`, `npm ci`, then `ls inbox/*.json >/dev/null 2>&1 && npx ajv-cli validate --spec=draft2020 -c ajv-formats -s schema/inbox-command.schema.json -d 'inbox/*.json' || exit 0`.

**Local loop:** `npm test` (unit + component, watch), `npm run test:all`, `npm run e2e` (headed). Pre-commit via `simple-git-hooks`: `lint-staged` (Biome) + gitleaks (warn-skip if absent) + `vitest related --run`; pre-push: typecheck + `check-features`. `docs/SETUP.md` lists `brew install gitleaks bats-core`.

## 11. Build milestones

Each milestone: worktree branch off `main`, `features.yaml` rows + failing acceptance tests first, squash, PR with green CI, Henrik merges, `release` moves `stable`, launchd picks it up. Estimates show raw → ×1.3 padded, per the plan's own rule.

**M0a — "Capture works in the browser" (raw 1 d → 1.5 d)**
Deliverables: both repos created with initial commits; single-package scaffold (Vite 7, Hono, Biome 2, Vitest 3, Playwright, `engines`/`.nvmrc`, CI skeleton, `tsconfig.domain.json`); `parseCapture` (`! @ ~ # + "quoted" !! ?`), reducer (`add done undo skip reschedule rollover`), zod schemas + `migrate.ts` (v1), `Clock`; server binding `127.0.0.1:7777` with D30 `security.ts`, `POST /api/capture`, item routes, `GET /api/state`, `GET /api/events`, `GET /api/health`, `GET /api/version`, `POST /api/_test/clock`, WAL journal + atomic `todos.json` writes into `~/quickdo-data` (git not yet wired), boot path for invalid/missing files; web: focus model, `CaptureBar` with chips, `TodayList`, `Backlog`, `ProgressBar`, `StartingBanner`, keys `/ Esc j k x u s t T b p ⌘Enter ?`; PWA manifest + icons + SW per D36; `features.yaml` seeded F-001…F-028 with `manual:` items; `docs/ACCEPTANCE.md`.
Tests: `parseCapture.test.ts` (≥ 25 cases), `reducer.test.ts` (incl. rollover), `migrate.test.ts` (v1), `focus.test.ts`, `api.capture.test.ts`, `security.test.ts`, `capture.bench.ts`, `state.boot.test.ts`, `CaptureBar.test.tsx`, `TodayList.test.tsx`, `ProgressBar.test.tsx`, `e2e/capture.spec.ts`, `e2e/pwa.spec.ts`, `check-features.test.ts`; F-001/002/004/008/023 done.
Definition of done: Henrik captures in Chrome, ticks things off, sees the bar, reloads and nothing is lost; CI green.

**M0b — "Lives on the Dock" (raw 0.5 d → 1 d)**
Deliverables: `bin/install-launchd.sh` (nvm-aware PATH, `WorkingDirectory`, logs dir, `bootstrap`/`bootout`), `bin/run.sh` (no pull yet, but the `exec` and circuit-breaker structure), `bin/quickdo` CLI with offline fallback, Shortcuts recipe with headers, Chrome install → Dock, `bin/doctor.ts` basic checks (PATH under launchd, TCC paths, origin), `docs/SETUP.md` first version.
Tests: `cli.test.ts`, `run.bats` (structure cases), doctor smoke; F-003 done, F-024 manual items ticked (Dock install, reboot + ⌃⌥Space).
Definition of done: capture from the Dock app, from ⌃⌥Space and from `quickdo "…"`; the server survives a reboot.

**M1 — "The agent can write" (raw 1.5 d → 2 d)**
Deliverables: `sync/mutex.ts`, `sync/git.ts` (coalesced cycle, failure classes, timeouts, backoff, explicit `git add` paths, history-rewrite detection, weekly mirror), `sync/inbox.ts` (Ajv2020, lstat/grammar checks, two-pass ingest, `baseUpdatedAt`, tombstones, rejected folder, retry-once), `sync/recovery.ts` (conflict branch as source, marker, journal replay), `watch.ts` (paused under mutex, hash-ignore), `SyncBadge` (offline/conflict/hermes last seen), agent toast + diff line, `suggestedFor` chip with `a`, `schema:build`/`schema:publish`, `docs/AGENT.md` = data-repo `README.md` (synthetic examples, PUT retry rules, filename grammar), data-repo `.gitignore` + `validate.yml`, `check-no-pii.sh` + local deny list + gitleaks + `allowlist.test.ts`; Henrik creates the PAT (expiry into `config.json`), writes the knowledge-vault note, and hand-writes one inbox file to prove the loop.
Tests: `sync.git.test.ts` (scenarios a–i), `inbox.ingest.test.ts`, `watch.test.ts`, `schema-parity.test.ts`, `schema-snapshot.test.ts`, `inbox-fixtures.test.ts`, `filename-grammar.test.ts`, `agent-doc.test.ts`, `allowlist.test.ts`, `check-no-pii.test.sh`, `reducer.property.test.ts`, `e2e/sync.spec.ts`; F-022 done.
Definition of done: an inbox file pushed by Hermes appears in the open window within 60 s in Backlog with a "hermes ↗" link; a malformed file lands in `inbox/rejected/` and shows a line in the UI; a train ride offline produces zero `conflict/*` branches; `git log` of the data repo has zero merge commits.

**M2 — "Time has a shape" (raw 1.5 d → 2 d)**
Deliverables: `schedule.json` anchors + `anchorFromCalendar` + CLI `anchor add|rm` + watch/hot-reload, `@` blocks, `Timeline` (vertical rail + compact strip), capacity meter with unioned busy intervals and `defaultEstimateMin`, soft Today cap (amber header), `Upcoming` view + `p` cycle, `[`/`]`/`+`, checkpoints on ≥ 60 min, `>` fallback syntax (derived default), ICS read for Google + Outlook (Phase A, full TZ/EXDATE handling), `migrate` v1→v2.
Tests: `capacity.test.ts`, `nextFreeSlot.test.ts`, `ics.test.ts` with fixtures, `Timeline.test.tsx`, `Upcoming.test.tsx`, `Backlog.test.tsx` (filter), `TodayList` soft-cap case, `watch.test.ts` schedule case, `cli.test.ts` anchor cases, `migrate.test.ts` v2, `e2e/today.spec.ts`, screenshot test; F-005/006/009/010/012/016 (syntax)/025/027 done.
Definition of done: Henrik sees lectures and calendar as grey blocks (counted once), places a block with `@`, sees next week's items in Upcoming, and the meter turns amber when over capacity.

**M3 — "Slips, cues, rituals, reminders" (raw 2 d → 2.5 d)**
Deliverables: `reminders.ts` + `reminders/schedule.ts` + Notification permission + `osascript` fallback; `c` cue editor, `if/when` syntax, `SlipBanner` (`notStarted`/`overran`, `2 o n f T s`, earliest only, fallback default when `missedYesterday`, auto-fallback at `fallback.at`), fresh start `.` with landmark hint rule, `2` two-minute start + `start` history, `repeat` items + Habits strip + consistency + never-miss-twice pin, ritual mode (`g e`, inline cue field, nudge at 4+), `ReviewStrip` (`g r`, persists until done, drop-after-3, outcome dots, archive + prune), lazy outcomes, miss-day nudge, self-forgiveness copy, `tips.json` (Appendix A) + `docs/SOURCES.md` + `TipBar`, `days/`, `weeks/`, `migrate` v2→v3.
Tests: `slip.test.ts`, `freshStart.test.ts`, `habits.test.ts`, `outcomes.test.ts`, `rituals.test.ts`, `reminders.schedule.test.ts`, `reminders.test.ts`, `tips.test.ts`, `migrate.test.ts` v3, `SlipBanner.test.tsx`, `HabitsStrip.test.tsx`, `RitualStrip.test.tsx`, `ReviewStrip.test.tsx`, `TipBar.test.tsx`, `e2e/slip.spec.ts`, `e2e/ritual.spec.ts`, `e2e/review.spec.ts`; F-007/011/013/014/015/016/017/018/019/020/021/026/028 done.
Definition of done: a block that has not started shows the banner and a notification; `n` moves exactly one other block; a habit missed yesterday is pinned with kind copy; the fallback applies itself at 16:00; the evening ritual commits items with cues without touching the fast path.

**M4 — "It maintains itself" (raw 1 d → 1.5 d)**
Deliverables: `update.ts` (ls-remote on `stable`, idle-by-mutation, exit 75), `run.sh` complete (dirty-tree refusal, `dist.next` swap with `rm -rf dist.prev`, best-effort steps, circuit breaker, `built-sha` after health, rollback reason), `quickdo rollback`, `UpdatePill` with rollback reason, web `registration.update()` triggers, `release` CI job, log rotation, `docs/SETUP.md` (fresh-Mac install in 5 commands, brew tools, TCC rule, pinned-tab alternative), branch protection, Dependabot, `doctor.ts` complete, `e2e/a11y.spec.ts`, knip.
Tests: `update.test.ts`, `run.bats` complete, doctor smoke in CI, `pwa.spec.ts` version-mismatch case; F-024 done.
Definition of done: a merged PR reaches the running app within 30 min of idleness with no action by Henrik; a build that crashes at boot is rolled back automatically within 1 min and the pill says so.

**M5 — "Calendar write-back" (raw 1 d Google → 1.5 d; +1 d → 1.5 d Outlook, optional)**
Deliverables: `calendar/provider.ts`, `google.ts` (PKCE loopback, `calendar.events`, pasted calendar id, one-way push, read-only moved/removed chips, live primary-calendar reads, own-event filter, Keychain tokens, Reconnect); then `microsoft.ts` per Phase C if Step 0 passes.
Tests: `provider.test.ts` against the in-memory fake, OAuth callback route test with a stubbed token endpoint, reconciliation idempotence, manual e2e behind an env flag (skipped in CI); `manual:` item "block visible on the phone within 30 s".
Definition of done: a block placed in Quickdo is visible on the phone's Google Calendar within 30 s; a block moved in Google shows the accept chip in Quickdo within 15 min.

Order is strict M0a → M0b → M1 → M2 → M3; M4 and M5 can be swapped. Raw total 8.5 d (+1 d optional) → **padded ≈ 11–12 focused days** (+1.5 d optional).

## 12. Risks & open questions for Henrik

**Questions that change the work**

1. Is `Europe/Berlin` the timezone and 08:00–22:00 the day window? (one config field each; affects every test fixture's `now`)
2. Raycast is not installed on this Mac (verified) — the Shortcut is the only hotkey path. Fine?
3. Does the university M365 tenant allow publishing an ICS link, and does the Step-0 consent/token check pass? Decides whether Outlook is read-only (ICS), integrated (Graph), or absent.
4. Is Chrome the primary browser for the installed app? Safari "Add to Dock" is best-effort only (no `beforeinstallprompt`, SSE suspension quirks).
5. Default capture target Backlog (this plan) — or default to Today? One config flag; changes the F-004/F-005 tests.
6. May the plan assume a single writing machine? A second Mac writing `todos.json` is out of scope; if wanted, per-item files become necessary and M1 grows by a day.
7. Should Hermes be allowed to mark items `done` (the plan says yes, with `baseUpdatedAt`) or only add/annotate?
8. Repo names `quickdo` / `quickdo-data` — confirm before `gh repo create`. Note the private repo's name reveals only that a data repo exists.
9. Reminder kinds on by default (all five) — or start with block start + fallback only?

**Reviewer fixes deliberately not applied, with reasons**

- *Bearer token for the hotkey/CLI path* (adversarial, D30): not added. The `X-Quickdo-Client` header already forces a preflight for any cross-origin page (which CORS-off rejects), and the `Host` check closes DNS rebinding; a token only defends against local processes, which the single-user Mac trust model accepts. It remains a 10-line addition if wanted.
- *`git checkout <built-sha>` after a failed `npm ci`/build* (completeness): not applied. Moving the tree back makes the next `git pull --ff-only` operate on a detached HEAD; keeping the tree at HEAD with `built-sha` unchanged yields the same clean retry (`npm ci` is idempotent and `HEAD ≠ built-sha` forces a rebuild), and `dist/` is untouched either way.
- *Inline cue prompt when an item enters Today* (completeness) vs *no prompts on the fast path* (adversarial): resolved in favour of the latter; the inline dashed-field spec is kept but used only inside ritual mode and via `c`.

**Known risks and mitigations**

- launchd + nvm: node lives only under `~/.nvm`; the plist PATH is rendered from `command -v node` and doctor proves `node -v` under `launchctl`. Keychain unlock happens at login; before that the agent retries.
- launchd + TCC: checkouts under `~/Documents`/Desktop/Downloads/iCloud get a silent EPERM; doctor fails on those paths and SETUP says so.
- Laptop asleep ⇒ agent pushes wait; `SyncBadge` shows "last sync 14:02" so the delay is visible; offline never enters RECOVERY (D27).
- Hermes writes garbage or breaks the contract ⇒ schema rejection, `rejected/` feedback, `validate.yml` red X for Henrik; Mac-owned paths are restored from the local branch; a history rewrite is force-fixed with lease; a weekly local mirror exists. The PAT cannot be path-scoped — RECOVERY is the enforcement.
- Hermes silently stops (expired PAT, 401s) ⇒ daily `ping` heartbeat; badge amber after 7 days; PAT expiry warned 14 days ahead.
- Stale agent snapshots ⇒ `baseUpdatedAt` on `update`/`done`; blind patches only for agent-owned fields.
- Google Testing-mode tokens expire in 7 days ⇒ consent screen set to production; Reconnect button; tokens in Keychain.
- Self-update bricking ⇒ CI gate + self-contained bundle + boot-health circuit breaker + `dist.prev` + pinned-tab fallback (`http://127.0.0.1:7777` works even if the PWA shell is stale).
- Over-building ⇒ the friction rule (zero-modal, one key/token, no prompts on the fast path, maps to a practice), strict M0a scope, and `features.yaml` — no feature enters without a practice and a test.
- Time zones / DST ⇒ all day logic on calendar dates and wall-clock times in one configured zone; DST switch pinned in tests; ICS Windows TZIDs mapped; travel across zones is out of scope.
- ICS freshness lags by minutes to hours ⇒ stated in the UI; live Google reads after M5.
- Safari PWA quirks ⇒ Chrome primary; `EventSource` reconnect + `visibilitychange` re-sync cover suspension.
- Notifications ⇒ PWA notification permission is per-origin; `osascript` fallback needs no permission; both opt-in.
- GitHub rate limits ⇒ `ls-remote` every 60 s ≈ 1 440 calls/day, far below limits; Hermes's Contents API calls are a handful per day.
- Dependency drift ⇒ every major pinned, `engine-strict`, Dependabot ignores Node-22-only majors.

## 13. Assumptions made

- Node 20.19.5 via nvm, npm 10, git 2.38, `gh` authenticated as `henrik253` with `repo` scope; no Rust, no bun, no Raycast/Alfred, no gitleaks/bats yet (brew).
- Henrik is fine with a ~40 MB Node process living at login, macOS notifications from the app, and his todos in plaintext in a private GitHub repo (same trust model as `henrik253/knowledge`).
- Hermes already knows how to PUT files via the Contents API with a fine-grained PAT (it does so for another private repo), takes standing instructions from the knowledge vault, and can read `README.md`/`schema/`/`tombstones.json` from the data repo.
- Production checkout `~/quickdo` on `stable`, data clone `~/quickdo-data`, config under `~/.config/quickdo/`, state under `~/.local/state/quickdo/`, cache under `~/.cache/quickdo/` — none under `~/Documents`; development in separate worktrees.
- Google Calendar is personal, Outlook is the university M365 tenant; the "Quickdo blocks" calendar is never an ICS source.
- Europe/Berlin, day 08:00–22:00, 90 min slack, evening nudge at 20:00, Today cap 5 (soft), slip grace 10 min, default estimate 30 min — all config values.
- Chrome is the install host; one machine writes.
- Fixtures, tips and every example in docs and this plan are synthetic; the only real identifier in the public repo is the GitHub username in repo URLs.

## Appendix A — `tips.json` (each entry: `text`, `practice`, `source`, `group`)

| # | Tip | Practice | Source | Group |
|---|---|---|---|---|
| 1 | Get it out of your head; the list remembers so you don't have to. | capture everything | Allen 2001, *Getting Things Done* | planning |
| 2 | An unfinished task stops nagging once you have a concrete plan for it — not when you finish it. | plan only the next step | Masicampo & Baumeister 2011 | planning |
| 3 | Write the next physical action, not the project. | plan only the next step | Allen 2001 | planning |
| 4 | "If it's 9 and I'm at the desk, then I open the draft" roughly doubles follow-through. | implementation intentions | Gollwitzer & Sheeran 2006 (meta-analysis, d ≈ .65) | planning |
| 5 | A time block is already an if-then: the cue is the clock. | implementation intentions | Gollwitzer 1999 | planning |
| 6 | People underestimate task duration by 30–50 %; pad it, then trust the padded number. | planning fallacy | Buehler, Griffin & Ross 1994 | capacity |
| 7 | Three to five committed items is a full day. The rest is backlog, not failure. | tiny daily list | Buehler, Griffin & Ross 1994; Allen 2001 | capacity |
| 8 | Keep the master list and today's commitment apart — the commitment is the one you protect. | backlog vs commitment | Allen 2001 | planning |
| 9 | Small visible wins are the strongest motivator on ordinary workdays. | progress principle | Amabile & Kramer 2011 | review |
| 10 | Leave finished items visible today; progress you can see is progress you feel. | progress principle | Amabile & Kramer 2011 | review |
| 11 | A calendar has capacity; a list does not. Give the important thing a block. | time-blocking | Newport 2016 (*Deep Work*); Buehler et al. 1994 | capacity |
| 12 | Self-set deadlines work, but people space them too loosely — add a midpoint check. | intermediate checkpoints | Ariely & Wertenbroch 2002 | planning |
| 13 | Fixed anchors, flexible content: rigid plans break on the first slip. | fixed anchors, flexible content | Polivy & Herman 1985 (what-the-hell effect) | slip |
| 14 | Keep 1–2 hours of slack. A full day is a fragile day. | slack | Buehler, Griffin & Ross 1994 | capacity |
| 15 | One slip moves the next block only. Never re-plan the whole day. | slip recovery | Polivy & Herman 1985 | slip |
| 16 | Forgiving yourself for procrastinating reduces procrastination next time. | self-forgiveness | Wohl, Pychyl & Bennett 2010 | slip |
| 17 | Self-compassion, not self-criticism, predicts getting back to it. | self-compassion | Sirois 2014 | slip |
| 18 | One missed day does not hurt a habit. Two in a row starts to. Never miss twice. | never miss twice | Lally et al. 2010 | habit |
| 19 | Habits take about two months to feel automatic, with big individual variation. Consistency, not perfection. | habit formation | Lally et al. 2010 (median 66 days) | habit |
| 20 | The next hour, tomorrow, Monday, the 1st: temporal landmarks make a clean slate real. | fresh-start effect | Dai, Milkman & Riis 2014 | slip |
| 21 | Decide the fallback before you need it: "if the morning block slips, then 15 minutes at 16:00". | pre-planned fallback | Gollwitzer & Sheeran 2006 | slip |
| 22 | Any small action beats more planning. Start the two-minute version. | behavioural activation | Jacobson et al. 1996; Allen 2001 (two-minute rule) | slip |
| 23 | Tonight, pick 2–3 for tomorrow as if-then sentences. Morning-you will thank you. | evening ritual | Gollwitzer & Sheeran 2006; Masicampo & Baumeister 2011 | review |
| 24 | Rescheduled three times? Drop it or shrink it. It is telling you something. | weekly review | Allen 2001 | review |
| 25 | A weekly review is where the backlog gets honest. | weekly review | Allen 2001 | review |
| 26 | Vague tasks get postponed; cued actions get done. | implementation intentions | Gollwitzer & Sheeran 2006 | planning |
| 27 | Over capacity? Move one to tomorrow now, not at 21:00. | capacity | Buehler, Griffin & Ross 1994 | capacity |

`docs/SOURCES.md` carries one line per paper stating the actual finding, so `tips.test.ts` can require that every tip's `source` appears there and every `practice` in `features.yaml` has ≥ 1 tip.