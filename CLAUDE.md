# CLAUDE.md — Quickdo

Keyboard-first personal todo app: installed Chrome PWA + local Node server (Hono) started by launchd; data as JSON in
the private repo `henrik253/quickdo-data`; an external agent (Hermes) adds todos via `inbox/*.json` files. The daily
method (backlog vs tiny Today, padded estimates, blocks, slip recovery, habits, rituals) is built into the mechanics.
Read `docs/PLAN.md` (intent), `docs/CONTRACTS.md` (module interfaces + ownership), `docs/ROADMAP.md` (status).

## Rules

- **Doing over planning.** No feature may add a step to the capture path. Zero modals.
- **No personal data in this public repo.** Fixtures/docs use `alice`, `Read paper X`, `Lecture A`, `example.com`.
  `scripts/check-no-pii.sh` and gitleaks run in CI. Secrets live in `~/.config/quickdo/`, data in `~/quickdo-data/`.
- **Every feature has an id (`F-0xx`) in `features.yaml` and a test whose title carries the tag.** A feature is `done`
  only when `npm run features` passes. Bug fixes start with a failing test at the lowest layer.
- **Keep `docs/ROADMAP.md` current** in the same change: move items, add implementation notes and known gaps.
- `src/domain` is pure (no I/O, no node/react imports); `tsconfig.domain.json` + `domain-purity.test.ts` enforce it.
- All config through `src/server/config.ts`; nothing else reads `process.env`.

## Commands

```bash
npm run dev:server   # tsx watch, serves API on 127.0.0.1:7777 (set QUICKDO_DATA_DIR / QUICKDO_HOME for a sandbox)
npm run dev          # vite dev server on 5173 with /api proxied to 7777
npm run build && npm start
npm test             # vitest watch (node + web projects)
npm run test:all && npm run e2e && npm run lint && npm run typecheck && npm run features && npm run privacy
```

## Git workflow

`main` is the only long-lived branch; CI fast-forwards `stable` after green, and the production checkout `~/quickdo`
follows `stable`. During the v0.1 prototype build commits go straight to `main`; afterwards: feature branch → squash →
PR → Henrik merges. Never commit anything from `~/quickdo-data` here.
