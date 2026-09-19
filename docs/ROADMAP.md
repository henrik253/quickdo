# Quickdo roadmap

Running log of what is built, in progress and planned, with the implementation details behind each item.
Update it in the same change as the work. Source of intent: `docs/PLAN.md`. Feature ↔ test gate: `features.yaml`.

Legend: `[x]` done · `[~]` in progress · `[ ]` planned. Dates are absolute.

## Status summary (2026-09-19)

- **v0.1 prototype built 2026-09-19** (M0a + M0b + M1 + M2-lite): 310 unit/integration tests + 8 Playwright e2e tests green,
  `npm run check` clean. `features.yaml`: 17 done, 8 in progress, 1 planned (see `docs/ACCEPTANCE.md`).
- Repos: `henrik253/quickdo` (public, code) and `henrik253/quickdo-data` (private, data) created 2026-09-19; the agent
  contract (`README.md`) and `schema/*.schema.json` are published in the data repo.
- Installed on this Mac as a launchd agent and verified end to end (CLI capture → push; Hermes inbox → ingest). CI green,
  `release` job moves `stable`. Next: Chrome install (Henrik), Hermes PAT, then M2 (ICS) and M3.

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
- [x] `@` blocks, `Timeline`, capacity meter, soft Today cap, `Upcoming` + `p`, `[` `]` `+`, checkpoint auto-set at the
      midpoint of blocks ≥ 60 min (no reminder fires yet — M3).
- [ ] CLI `quickdo anchor add|rm`.
- [ ] ICS read for Google + Outlook (Phase A) — **after v0.1**.

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
