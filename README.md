# Quickdo

A keyboard-first todo app that lives in your Dock. One capture line, a tiny quick-syntax, a global hotkey, and a
science-based daily method (backlog vs. a tiny Today list, padded estimates, time blocks, slip recovery that moves only
the next block, never-miss-twice habits, an evening ritual) built into the mechanics rather than bolted on.

- **Runs locally**: a small Node server on `127.0.0.1:7777` serves an installable PWA. Install it from Chrome and it
  behaves like an app; launchd starts the server at login.
- **Your data is JSON in your own private git repo.** An external agent can add todos by dropping files into `inbox/`;
  the app pulls, validates and shows them within a minute. No cloud service in between.
- **Tested**: every feature has an id in `features.yaml` and CI refuses to call it done without a passing test.

See `docs/PLAN.md` for the full design, `docs/SETUP.md` to install, `docs/AGENT.md` for the agent contract, and
`docs/ROADMAP.md` for status.

MIT License.
