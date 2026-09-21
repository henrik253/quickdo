# Quickdo roadmap

Running log of what is built, in progress and planned, with the implementation details behind each item.
Update it in the same change as the work. Source of intent: `docs/PLAN.md`. Feature ↔ test gate: `features.yaml`.

Legend: `[x]` done · `[~]` in progress · `[ ]` planned. Dates are absolute.

## Status summary (2026-09-19)

- **v0.1 prototype built 2026-09-19** (M0a + M0b + M1 + M2-lite), installed on Henrik's Mac; **v0.2 the same evening**
  adds LLM formatting of captures (Haiku), a ✕ remove button, and removes the calendar view. `npm run check` clean;
  see `docs/ACCEPTANCE.md` for the feature table.
- Repos: `henrik253/quickdo` (public, code) and `henrik253/quickdo-data` (private, data) created 2026-09-19; the agent
  contract (`README.md`) and `schema/*.schema.json` are published in the data repo.
- Installed on this Mac as a launchd agent and verified end to end (CLI capture → push; Hermes inbox → ingest). CI green,
  `release` job moves `stable`. Next: Chrome install (Henrik), Hermes PAT, then M2 (ICS) and M3.

## v0.2 — Henrik's first feedback (2026-09-19, same day)

- [x] **LLM formatting of captures** (F-028): every capture from the UI, hotkey or CLI is stored immediately as typed,
      then a background call to Claude Haiku (`claude-haiku-4-5`, `client.messages.parse` with a zod output format)
      rewrites it into a clean todo: verb-first title, details into `note`, `due` for stated deadlines ("until Friday"),
      `scheduledFor` only when the user says when they will do it, estimate/project/tags/cue only when obvious.
      Parser-extracted fields always win; a user edit that lands before the model answers wins too (result `skipped`);
      failures leave the item as typed (`failed`). The raw text is kept in `item.llm.raw`. UI shows a "✨ formatting…"
      chip while pending. Code: `src/server/llm/format.ts`, wiring in `app.ts` (`runFormat`), tests in
      `test/server/llm.format.test.ts` with a fake formatter (no network in tests).
- [x] **`.env` for the Anthropic key** (`.env.example` committed, `.env` git-ignored): `config.ts` reads
      `<checkout>/.env` (real environment wins), `ANTHROPIC_API_KEY`, `QUICKDO_LLM_MODEL`, `QUICKDO_LLM=off`. The key is
      re-read on every capture, so adding it later needs no restart. Never logged, never in API responses.
      `[ ]` Henrik: paste the key into `~/quickdo/.env`.
- [x] **Remove button** (F-027): a ✕ at the end of every open row (Today, Backlog, Upcoming, habits) drops the item
      (same as `d`); faint until hover / cursor.
- [x] **Calendar view removed** at Henrik's request: `Timeline.tsx` deleted, single-column layout. Capacity is still
      computed (the tips use it); anchors/blocks still work via `@`, `[`, `]`, `+`. F-010 back to planned, F-009/F-012
      re-titled in `features.yaml`.

## v0.5 — Checkbox and always-visible upcoming (2026-09-21)

- [x] **Finish checkbox** (F-033): every row starts with a checkbox (tick = done, untick = undo; `x`/`u` still work).
      A todo with sub-todos cannot be finished while one is open — the reducer's `done` refuses with
      "N sub-todos still open", so the checkbox is disabled with that hint, `x` shows it as a chip, and an agent `done`
      command is rejected the same way. Ticking the last sub-todo shows "tick the todo to finish it".
- [x] **Upcoming always visible** (F-034): the `p` toggle is gone; the list is Today → upcoming days (grouped by date,
      hidden when empty) → backlog. Cursor order follows (`visibleRows`). Upcoming rows are finished like any other.

## v0.4 — Multi-line captures with notes and sub-todos (2026-09-20)

- [x] **Capture bar is a growing textarea** (F-031): Enter inserts a new line; Shift+Enter or the **Add** button submits;
      ⌘Enter / the **Today** button adds to Today. `parseCapture()` now splits lines: the first non-empty line is the
      heading and is parsed exactly as before (`!day @time ~est #project +tag when … due …`); `- ` / `* ` / `[ ] ` /
      `[x] ` lines become `item.subtasks` (`{ id, title, done }`, ULIDs from the reducer); every other line joins
      `item.note`. Tokens on later lines are plain text. The LLM formatter only sees the heading, so notes and sub-todos
      stay exactly as typed. `PATCH /api/items/:id` accepts `subtasks`.
- [x] **Fold / unfold** (F-032): rows keep showing only the heading + chips, plus an `n/m` sub-todo chip; `▸` (or
      Space on the highlighted row) opens the note and the sub-todos with checkboxes that PATCH the item. Fold state is
      per browser session, not persisted.
- [ ] Agent contract: `add` commands cannot carry sub-todos yet (`docs/AGENT.md` unchanged).

## v0.3 — Done tracking (2026-09-19)

- [x] **Done tracker** (F-029): `DoneChart` under the progress bar shows finished items per day (3 days / 7 days /
      1 month) or per week (3 months, 13 bars ending today); the range buttons are remembered in `localStorage`.
      Source: `GET /api/stats?range=` → `buildStats()` in `src/domain/state/stats.ts`, which nets `done`/`undone`
      history events per item and day — so items cleared from the list still count. The store now loads the last four
      months of `history/*.jsonl`. (Henrik wrote "7w"; implemented as 7 days.)
- [x] **Clear done** (F-030): "clear done" in the done header and the ✕ on done rows dispatch the new reducer action
      `archive` (all done non-repeat items, or one id); the server appends them to `archive/YYYY-MM.json` in the data
      repo (Mac-owned, synced) and they leave `todos.json`. Routes: `POST /api/day/clearDone`,
      `POST /api/items/:id/archive`. No automatic Sunday archive yet (M3).

## M0a — Capture works in the browser

- [x] Repos created on GitHub (2026-09-19).
- [x] Scaffold: single npm package, Vite 7 + React 18 (web), Hono 4 (server), Vitest 4 with two projects
      (`node`, `web`/jsdom), Playwright against the real built server, Biome 2, `tsconfig.domain.json` purity gate.
      Node pinned via `.nvmrc` 20.19.5 + `engine-strict`. Vitest 4 (not 3) because 4.x supports Node 20 and Vite 7.
- [x] Contracts: `src/domain/types.ts`, `src/server/sync/types.ts`, `docs/CONTRACTS.md` (module ownership + APIs).
- [x] Domain (2026-09-19): `src/domain/{time,capture/parseCapture,state/reducer,state/derive,state/initial,plan/busy,plan/nextFreeSlot,schema/index}.ts`;
      full grammar incl. chrono-node for `@<day> <time>`, ULID ids seeded from the injected clock, zod 4 schemas (items keep
      unknown keys, inbox commands strict), `scripts/schema-build.ts` → `schema/*.schema.json`. 123 tests (parser, reducer,
      next-free-slot, time). Derive/schema/property/purity suites added the same day: 182 domain tests, 99.6 % line
      coverage. Two reducer bugs found by the property tests were fixed: `edit` with an `undefined` required field
      (title/tags/order are never deleted) and zero-minute blocks (every block is floored at 5 min, the schema minimum).
- [x] Server (2026-09-19): `src/server/{config,clock,log,broadcast,state,security,static,app,update,index}.ts`. `config.ts` is
      the only `process.env` reader (`QUICKDO_HOME`, `QUICKDO_DATA_DIR`, `QUICKDO_STATE_DIR`, `QUICKDO_PORT`, `QUICKDO_SYNC=off`,
      `QUICKDO_TEST_CLOCK=1`, `QUICKDO_BUILD_SHA`). `state.ts` = the SyncHost: boot load with `todos.json.invalid-<ts>` +
      `git show HEAD:todos.json` fallback, history in `history/YYYY-MM.jsonl`, atomic writes, rollover on boot **and** lazily
      on the first request of a new day, `day.json` in the state dir. `app.ts` exports `createApp()` (tests run in-process,
      no port): security middleware (415/403/421), all endpoints, SSE (`state`, `sync`, `agent`, `update`), static `dist/web`
      with SPA fallback. `PATCH` accepts `null` to clear a field. `update.ts` polls `stable` every 30 min and exits 75 when
      idle. 51 tests in `test/server/`. Gap: no file watcher for hand edits of `todos.json` (picked up after a rebase or at boot).
- [x] Web (2026-09-19): `src/web/{main,App,api,store,focus,styles.css,tips.json,testids}` + components `CaptureBar`
      (live chips from the shared parser, ⌘Enter = Today, draft kept in localStorage on failure, `?` filter), `TodayList`
      (row keys, amber soft-cap header, rollover chip, inline editors for `e r @ c`), `HabitsStrip`, `Backlog`/`Upcoming` (`p`),
      `ProgressBar` (segments), `Timeline` (vertical column ≥ 900 px, strip below; anchors, blocks, now-line, slack band,
      capacity meter), `SlipBanner`, `TipBar` (26 tips with sources, contextual groups), `SyncBadge`, `StartingBanner`,
      `KeyHelp`, `Toast`; optimistic updates through the shared reducer; PWA update pill (prompt mode). 43 component tests.
      Gaps: `g e` / `g r` are chips saying "coming in M3"; `2` starts without a countdown; `f` sets a 16:00 fallback block via
      PATCH; no component tests for Timeline/SyncBadge/StartingBanner/HabitsStrip; dark theme and 400 px layout untested visually.
- [x] Tests (2026-09-19): 310 Vitest tests (domain 182, server 51 + sync 10, web 43, ops/scripts 24) and 8 Playwright specs
      (`e2e/capture.spec.ts`, `today.spec.ts`, `pwa.spec.ts`) against the real built server with a temp data dir and the test
      clock. `features.yaml` filled with `file#title` refs; `npm run features` renders `docs/ACCEPTANCE.md`.
- [x] CI (`.github/workflows/ci.yml`, 2026-09-19): lint, typecheck, unit (+ bash PII tests), e2e, features (+ `docs/ACCEPTANCE.md`
      staleness), privacy (`check-no-pii.sh` + gitleaks), release → `stable` (`contents: write`). Not yet run on GitHub.
- [x] `scripts/check-features.ts` + test; renders `docs/ACCEPTANCE.md`; `--check` flag for staleness. `.skip/.todo` only fails
      `done` features so in-progress features can use `it.todo`. Manual items are rendered, not enforced.

## M0b — Lives on the Dock

- [x] `bin/quickdo` CLI (2026-09-19): capture/status/sync/open/doctor/install/uninstall; arg parsing in `bin/lib/args.mjs`
      (port precedence `--port` > `QUICKDO_PORT` > config.json > 7777); tests `test/cli*.test.ts` against a stub `node:http` server.
- [x] `bin/run.sh` (ff-only pull of `stable` when the tree is clean, `npm ci` only on lockfile change vs `built-sha`, build into
      `dist.next/` and swap keeping `dist.prev/`, exit 75 passthrough; own 15 s watchdog, no `timeout` binary needed) +
      `bin/install-launchd.sh` / `bin/uninstall-launchd.sh` + `launchd/io.github.henrik253.quickdo.plist.template`.
      `test/run-sh.test.ts` covers build failure keeping `dist/`, swap + sha record, exit-code passthrough. The pull path is untested
      against a real remote.
- [x] `docs/SETUP.md`, `docs/shortcuts/README.md` (recipe written from the documented Shortcuts actions; not yet verified in
      Shortcuts.app — F-003 manual item).
- [x] Icons: `public/icon.svg` + `public/icons/{192,512,maskable-512}.png` from `scripts/make-icons.mjs` (pure-Node PNG encoder).
- [x] Production checkout `~/quickdo` on `stable`, data clone `~/quickdo-data`, launchd agent `io.github.henrik253.quickdo`
      installed 2026-09-19 (`bin/install-launchd.sh`); `run.sh` rebuilt on first start and the server answered on
      `127.0.0.1:7777`. Chrome "Install app" is Henrik's click.

## M1 — The agent can write

- [x] `src/server/sync/{index,mutex,git,cycle,inbox,recovery}.ts` (2026-09-19): p-queue mutex; one coalesced cycle 3 s after a
      local change that commits **and** pushes (no separate 15 s push timer); `ls-remote` pre-check; rebase only when origin
      moved; ingest with `INBOX_FILENAME` grammar, 32 KB cap, strict schema, `rejected/<name>` + `.error.txt`; RECOVERY
      (`conflict/<ts>` branch, reset to origin, Mac-owned paths restored, push in the same cycle); offline backoff 5 s → 5 min;
      identity via `-c user.name/email` on every git call. 10 real-git tests (bare repo + mac/hermes clones). Gaps: no boot-time
      recovery marker; server-side push rejections only set `lastError`.
- [x] `docs/AGENT.md` = data-repo `README.md` + `schema/*.schema.json` published (2026-09-19).
- [x] Web: `SyncBadge` states, agent toast, `suggestedFor` chip (`a`), "hermes ↗" link.
- [x] Verified 2026-09-19 on the live data repo: a CLI capture was committed and pushed (`ui: N change(s)`); an inbox file
      PUT through the Contents API was ingested on the next cycle (`ingest: 1 from hermes (0 rejected)`), removed from
      `inbox/` on origin, and shown in the app with the suggestion chip. Malformed-file path covered by tests only.
- [ ] Henrik: create the fine-grained PAT for Hermes (Contents: read & write on `quickdo-data`) and point Hermes at the
      knowledge-vault note.
- [x] Privacy guards: `scripts/check-no-pii.sh` (patterns built from fragments; lines containing `check-no-pii` or `pii:allow`
      are exempt because the docs quote the patterns; optional `~/.config/quickdo/pii-denylist.txt`), `scripts/check-no-pii.test.sh`
      (10 cases), gitleaks in CI.
- [ ] Henrik: create the fine-grained PAT for Hermes (Contents: read & write on `quickdo-data`), add the knowledge-vault note.

## M2 — Time has a shape (v0.1 ships the "lite" subset)

- [x] `schedule.json` anchors + `GET/PUT /api/schedule` (edit the file or PUT; no CLI `anchor add|rm` yet).
- [x] `@` blocks, soft Today cap, `Upcoming` + `p`, `[` `]` `+`, checkpoint auto-set at the midpoint of blocks ≥ 60 min
      (no reminder fires yet — M3). The `Timeline` and the capacity meter shipped in v0.1 and were removed in v0.2.
- [ ] CLI `quickdo anchor add|rm`.
- [ ] ICS read for Google + Outlook (Phase A) — on hold: the calendar view was removed in v0.2; revisit only if Henrik
      wants calendar data back (e.g. as capacity input without a visual timeline).

## M3 — Slips, cues, rituals, reminders

- [ ] Reminders (SSE + Notification + `osascript` fallback); `c` cue; `SlipBanner`; fresh start `.`; `2` two-minute start;
      habits + never-miss-twice; ritual mode `g e`; `ReviewStrip` + archive; self-forgiveness copy; tips contextual groups.
      (v0.1 ships: derive-level slip detection, `.` fresh start, habits strip basic, tips basic — see status above.)

## M4 — It maintains itself

- [ ] `update.ts` (poll `stable` every 30 min, exit 75 when idle), `run.sh` pull + build + swap, `UpdatePill`,
      `release` CI job, branch protection, Dependabot, `doctor` complete.

## M5 — Calendar write-back

- [ ] Google one-way push (Phase B), Outlook (Phase C) if the tenant allows it.

## Implementation notes

- 2026-09-19 (sync): on the CI runner the "20 rapid local changes while hermes pushes" test hit RECOVERY twice in a
  row — the UI writes `todos.json` while a cycle runs, and a `rebase --autostash` can fail on a file that changed
  underneath it. That is not a real conflict: `rebaseOntoRemote()` in `src/server/sync/cycle.ts` now aborts, commits
  the freshly written Mac-owned files (`ui: N change(s)`) and retries the rebase once before falling back to RECOVERY.

- 2026-09-19 (v0.2 deploy incident): the first self-update pulled the new commit but `npm ci` failed twice with
  `ENOTEMPTY … node_modules/date-fns` (npm 10 deleting an existing `node_modules`), so `run.sh` correctly kept the old
  build — but `/api/version` reported git HEAD and the update check compared `stable` against HEAD, so the app looked
  current and would never have retried. Fixes: `run.sh` now removes `node_modules` before `npm ci` and retries once from
  scratch; it exports `QUICKDO_BUILD_SHA` from `built-sha` so `/api/version` and `update.ts` use the sha the running
  build was made from. Production was repaired by hand (`rm -rf node_modules && npm ci && npm run build`).

- 2026-09-19: build organisation — modules built in parallel git worktrees (`../quickdo-wt/<module>`) against
  `docs/CONTRACTS.md`; branches `domain` and `ops` merged into `main` first, then `server`, `sync`, `web`, `domain-tests`.

- 2026-09-19: Vitest 4.1 chosen over 3.x (3.x lacks Vite 7 support in its peer range). Vite 7 needs Node ≥ 20.19 — satisfied.
- 2026-09-19: `day.json` (DayState) lives in the local state dir, not the data repo; it is per-machine.
- 2026-09-19: the plan assumed Europe/Berlin, but this Mac runs on US Central time; `~/.config/quickdo/config.json`
  now sets `timezone: America/Chicago`. All day logic follows the configured zone, so nothing else changed.

## Known gaps / open questions

- v0.1 feature status is in `features.yaml` / `docs/ACCEPTANCE.md`. In progress: F-007 cue prompting in the ritual, F-011
  checkpoint reminders, F-012 anchor CLI, F-016 auto-applied fallback, F-017 two-minute countdown, F-019 ritual mode,
  F-020 Sunday review, F-024 launchd install on this Mac. Planned: F-023 reminders.
- `resolveOverlap` clamps a pushed block at `dayEnd`, so a late block can move earlier than it was (still only one block
  moves). Design question for M3.
- The macOS Shortcut recipe is unverified in Shortcuts.app (F-003 manual item).

- Open questions from `docs/PLAN.md` §12 answered by assumption for v0.1: repo names `quickdo`/`quickdo-data`,
  America/Chicago (corrected from the plan's Europe/Berlin) 08:00–22:00, capture defaults to Backlog, Chrome as install host, Hermes may mark items done with
  `baseUpdatedAt`, Node 20.19 kept.
