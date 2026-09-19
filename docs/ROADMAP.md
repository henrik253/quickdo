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
- [ ] Domain: `parseCapture` (full grammar), reducer (all actions), `derive`, `nextFreeSlot`, zod schemas, migrate v1,
      `scripts/schema-build.ts` → `schema/*.json`.
- [ ] Server: config resolution (`QUICKDO_HOME`, `QUICKDO_DATA_DIR`, `QUICKDO_PORT`, `QUICKDO_SYNC`, `QUICKDO_TEST_CLOCK`),
      `state.ts` (atomic writes, history append, rollover on boot), routes, security middleware, SSE, static `dist/web`.
- [ ] Web: focus model, `CaptureBar` with chips, `TodayList`, `Backlog`, `Upcoming`, `ProgressBar`, `SyncBadge`,
      `StartingBanner`, `TipBar`, keyboard map, PWA (manifest, icons, service worker in prompt mode).
- [ ] Tests: domain unit + property tests, server integration (`app.request()`), component tests, `e2e/capture.spec.ts`,
      `e2e/pwa.spec.ts`; `features.yaml` seeded; `scripts/check-features.ts`.
- [ ] CI (`.github/workflows/ci.yml`): lint, typecheck, unit, e2e, features, privacy, release → `stable`.

## M0b — Lives on the Dock

- [ ] `bin/quickdo` CLI (capture, status, sync, open, doctor, install/uninstall).
- [ ] `bin/run.sh` + `bin/install-launchd.sh` + plist template (absolute node path, PATH, logs, KeepAlive).
- [ ] `docs/SETUP.md`, `docs/shortcuts/README.md` (⌃⌥Space Shortcut recipe).
- [ ] Production checkout `~/quickdo` on `stable`, data clone `~/quickdo-data`, launchd agent installed on this Mac.

## M1 — The agent can write

- [ ] `src/server/sync/`: mutex, cycle (ls-remote → fetch → rebase → ingest → flush → commit → push), failure classes
      (offline vs recovery), RECOVERY with `conflict/<ts>` branch, inbox validation + `rejected/`.
- [ ] `docs/AGENT.md` = data-repo `README.md` (contract + worked examples); `schema/` copied into the data repo.
- [ ] Web: `SyncBadge` states, agent toast, `suggestedFor` chip (`a`), "hermes ↗" link.
- [ ] Privacy guards: `scripts/check-no-pii.sh`, gitleaks in CI.
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

- 2026-09-19: Vitest 4.1 chosen over 3.x (3.x lacks Vite 7 support in its peer range). Vite 7 needs Node ≥ 20.19 — satisfied.
- 2026-09-19: `day.json` (DayState) lives in the local state dir, not the data repo; it is per-machine.

## Known gaps / open questions

- Open questions from `docs/PLAN.md` §12 answered by assumption for v0.1: repo names `quickdo`/`quickdo-data`,
  Europe/Berlin 08:00–22:00, capture defaults to Backlog, Chrome as install host, Hermes may mark items done with
  `baseUpdatedAt`, Node 20.19 kept.
