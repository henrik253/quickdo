# Quickdo roadmap

Running log of what is built, in progress and planned, with the implementation details behind each item.
Update it in the same change as the work. Source of intent: `docs/PLAN.md`. Feature ↔ test gate: `features.yaml`.

Legend: `[x]` done · `[~]` in progress · `[ ]` planned. Dates are absolute.

## Status summary (2026-09-19)

- Prototype target: **v0.1 = M0a + M0b + M1 + M2-lite**, usable on 2026-09-20.
- Repos: `henrik253/quickdo` (public, code) and `henrik253/quickdo-data` (private, data) created 2026-09-19.

## M0a — Capture works in the browser

- [x] Repos created on GitHub (2026-09-19).
- [x] Scaffold: single npm package, Vite 7 + React 18 (web), Hono 4 (server), Vitest 4 with two projects
      (`node`, `web`/jsdom), Playwright against the real built server, Biome 2, `tsconfig.domain.json` purity gate.
      Node pinned via `.nvmrc` 20.19.5 + `engine-strict`. Vitest 4 (not 3) because 4.x supports Node 20 and Vite 7.
- [x] Contracts: `src/domain/types.ts`, `src/server/sync/types.ts`, `docs/CONTRACTS.md` (module ownership + APIs).
- [x] Domain (2026-09-19): `src/domain/{time,capture/parseCapture,state/reducer,state/derive,state/initial,plan/busy,plan/nextFreeSlot,schema/index}.ts`;
      full grammar incl. chrono-node for `@<day> <time>`, ULID ids seeded from the injected clock, zod 4 schemas (items keep
      unknown keys, inbox commands strict), `scripts/schema-build.ts` → `schema/*.schema.json`. 123 tests (parser, reducer,
      next-free-slot, time). `[~]` derive/schema/property/purity tests being added.
- [ ] Server: config resolution (`QUICKDO_HOME`, `QUICKDO_DATA_DIR`, `QUICKDO_PORT`, `QUICKDO_SYNC`, `QUICKDO_TEST_CLOCK`),
      `state.ts` (atomic writes, history append, rollover on boot), routes, security middleware, SSE, static `dist/web`.
- [ ] Web: focus model, `CaptureBar` with chips, `TodayList`, `Backlog`, `Upcoming`, `ProgressBar`, `SyncBadge`,
      `StartingBanner`, `TipBar`, keyboard map, PWA (manifest, icons, service worker in prompt mode).
- [ ] Tests: domain unit + property tests, server integration (`app.request()`), component tests, `e2e/capture.spec.ts`,
      `e2e/pwa.spec.ts`; `features.yaml` seeded; `scripts/check-features.ts`.
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
- [ ] Production checkout `~/quickdo` on `stable`, data clone `~/quickdo-data`, launchd agent installed on this Mac.

## M1 — The agent can write

- [ ] `src/server/sync/`: mutex, cycle (ls-remote → fetch → rebase → ingest → flush → commit → push), failure classes
      (offline vs recovery), RECOVERY with `conflict/<ts>` branch, inbox validation + `rejected/`.
- [x] `docs/AGENT.md` written (contract + worked examples). `[ ]` copy into the data repo as `README.md` together with `schema/`.
- [ ] Web: `SyncBadge` states, agent toast, `suggestedFor` chip (`a`), "hermes ↗" link.
- [x] Privacy guards: `scripts/check-no-pii.sh` (patterns built from fragments; lines containing `check-no-pii` or `pii:allow`
      are exempt because the docs quote the patterns; optional `~/.config/quickdo/pii-denylist.txt`), `scripts/check-no-pii.test.sh`
      (10 cases), gitleaks in CI.
- [ ] Henrik: create the fine-grained PAT for Hermes (Contents: read & write on `quickdo-data`), add the knowledge-vault note.

## M2 — Time has a shape (v0.1 ships the "lite" subset)

- [ ] `schedule.json` anchors + `PUT /api/schedule` (+ CLI `anchor add|rm`).
- [ ] `@` blocks, `Timeline` (vertical day column, anchors, blocks, now-line, slack band), capacity meter, soft Today cap,
      `Upcoming` + `p`, `[` `]` `+`, checkpoints on ≥ 60 min.
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

## Known gaps / open questions

- Open questions from `docs/PLAN.md` §12 answered by assumption for v0.1: repo names `quickdo`/`quickdo-data`,
  Europe/Berlin 08:00–22:00, capture defaults to Backlog, Chrome as install host, Hermes may mark items done with
  `baseUpdatedAt`, Node 20.19 kept.
