# Setup — fresh Mac to a Dock app

Quickdo is a local Node server (launchd login agent) plus an installed Chrome PWA. Everything personal
lives outside the code checkout: data in `~/quickdo-data` (private git repo), config and secrets in
`~/.config/quickdo/`. Paths below are placeholders; `~` is your home directory.

## 1. Install (five commands)

```bash
# Node 20.19 via nvm (https://github.com/nvm-sh/nvm) — the repo pins the version in .nvmrc
nvm install 20.19.5 && nvm use 20.19.5

git clone https://github.com/henrik253/quickdo.git ~/quickdo      # NOT under ~/Documents (see Troubleshooting)
cd ~/quickdo && git checkout stable                                # the CI-green branch launchd follows
npm ci && npm run build
bin/install-launchd.sh                                             # renders + loads the launchd agent, prints the log paths
```

Then open <http://127.0.0.1:7777>. The first start creates an empty `~/quickdo-data/todos.json` if there is no data
repo yet (git sync stays disabled until the clone in step 3 exists).

Optional: put the CLI on your PATH — `ln -s ~/quickdo/bin/quickdo /usr/local/bin/quickdo` (or `npm link`), then
`quickdo "Read paper X !today"`, `quickdo status`, `quickdo doctor`.

## 2. Make it a Dock app

In Chrome, open <http://127.0.0.1:7777> → menu **⋮** → **Cast, save, and share** → **Install page as app…**
(older Chrome: **⋮ → Install Quickdo**) → **Install**. The app window opens; right-click its Dock icon →
**Options → Keep in Dock**. It launches like any app, focused on the capture bar, and keeps working while the server
restarts (the shell is cached; the API is never cached).

Global hotkey ⌃⌥Space: `docs/shortcuts/README.md` (a six-step macOS Shortcut).

## 2b. Let a model tidy your captures (optional)

Copy `.env.example` to `.env` in the checkout that runs the server (`~/quickdo/.env`) and paste your Anthropic key:

```bash
cp ~/quickdo/.env.example ~/quickdo/.env && open -e ~/quickdo/.env   # set ANTHROPIC_API_KEY=sk-ant-...
```

No restart needed: the key is read on the next capture. From then on every todo you type is stored immediately and
then rewritten by Claude Haiku (`claude-haiku-4-5`) into a clean, verb-first title with the details moved into the
note and deadlines like "until Friday" turned into a due date. A "✨ formatting…" chip shows while it works; if you
edit the item before the model answers, your edit wins. The original text is kept in the item (`llm.raw`).
`QUICKDO_LLM=off` in `.env` switches it off; `QUICKDO_LLM_MODEL` picks another model. `.env` is git-ignored and the
key never leaves your Mac except in the request to Anthropic.

## 3. Data repo

```bash
git clone https://github.com/henrik253/quickdo-data.git ~/quickdo-data
```

The server commits `todos.json`, `schedule.json`, `history/` and `archive/` there and pushes with your normal git
credentials (the `gh` credential helper or the macOS keychain — `git push` from a terminal must work without a
prompt). The agent (Hermes) writes only `inbox/*.json`; see `docs/AGENT.md`, which is the data repo's `README.md`.
`quickdo status` shows the sync state; `quickdo sync` forces a cycle.

## 4. Where things live

| What | Where | Notes |
|---|---|---|
| code checkout | `~/quickdo` | follows `stable`; `bin/run.sh` pulls + rebuilds on every (re)start |
| data | `~/quickdo-data` | private repo clone; one writer per path (docs/PLAN.md §6) |
| config | `~/.config/quickdo/config.json` | optional; copy `config.example.json`; keys: `dataDir, port, timezone, dayStart, dayEnd, slackMinutes, eveningRitualAt, todayCap, slipGraceMin, defaultEstimateMin, pollSeconds, reminders, hermesPatExpires` |
| secrets | `~/.config/quickdo/secrets.json` | mode 600; ICS URLs and OAuth ids (calendar phases) — never in a repo |
| Anthropic key | `~/quickdo/.env` | `ANTHROPIC_API_KEY=` for LLM formatting; git-ignored; re-read on every capture |
| local deny list | `~/.config/quickdo/pii-denylist.txt` | optional extra patterns for `scripts/check-no-pii.sh` |
| per-machine state | `~/.local/state/quickdo/` | `day.json` (today's ritual state), `built-sha` (last build) |
| cache | `~/.cache/quickdo/` | calendar cache (later) |
| launchd agent | `~/Library/LaunchAgents/io.github.henrik253.quickdo.plist` | rendered from `launchd/*.plist.template` |
| logs | `~/Library/Logs/quickdo/quickdo.log`, `quickdo.err.log` | single-line JSON from the server, `run.sh:` lines from the launcher |

Environment overrides (for sandboxes and tests): `QUICKDO_HOME`, `QUICKDO_DATA_DIR`, `QUICKDO_PORT`,
`QUICKDO_SYNC=off`, `QUICKDO_TEST_CLOCK=1`; for the launcher `QUICKDO_NODE`, `QUICKDO_STATE_DIR`,
`QUICKDO_NO_PULL=1`, `QUICKDO_FORCE_BUILD=1`.

## 5. Day-to-day

- `quickdo doctor` — node/git/gh on PATH, agent loaded, port answering, data repo has `origin`, config, secrets
  mode, checkout not under a TCC folder.
- `tail -f ~/Library/Logs/quickdo/quickdo.log` — what the server is doing.
- `launchctl kickstart -k gui/$(id -u)/io.github.henrik253.quickdo` — restart now (the server also restarts
  itself with exit 75 after `stable` moved and the app is idle; `run.sh` then pulls and rebuilds, keeping the old
  `dist/` if the build fails).
- Updating by hand: `cd ~/quickdo && git pull --ff-only origin stable && npm ci && npm run build`, then kickstart.

## 6. Uninstall

```bash
~/quickdo/bin/uninstall-launchd.sh      # launchctl bootout + removes the plist (or: quickdo uninstall)
rm -rf ~/quickdo                        # the code
# keep or remove ~/quickdo-data, ~/.config/quickdo, ~/.local/state/quickdo, ~/Library/Logs/quickdo yourself
```

In Chrome: open the app → **⋮ → Uninstall Quickdo**.

## 7. Troubleshooting

**launchd cannot see nvm's node.** launchd agents do not read your shell profile, so `node` from nvm is invisible
unless the plist carries an absolute path. `bin/install-launchd.sh` writes the absolute path of `command -v node`
into `QUICKDO_NODE` and prepends its directory to the agent's `PATH`. After `nvm install` of a new version,
re-run `bin/install-launchd.sh` so the plist points at the new binary. Symptom: `quickdo.err.log` says
`node: command not found` or `env: node: No such file or directory`.

**TCC and ~/Documents / ~/Desktop / ~/Downloads.** macOS treats these folders as protected. A launchd agent that
runs from there, or a data repo living there, fails with a silent `EPERM` (the log shows `Operation not permitted`
on `todos.json`, or nothing at all). Keep the checkout at `~/quickdo` and the data at `~/quickdo-data`.
`quickdo doctor` and the installer warn about this.

**Port 7777 in use.** `lsof -nP -iTCP:7777 -sTCP:LISTEN` shows who holds it. Either stop that process, or set
`"port": 7778` in `~/.config/quickdo/config.json`, re-run `bin/install-launchd.sh`, and use
`http://127.0.0.1:7778` (the CLI reads the same config; the Shortcut URL must be edited by hand).

**The agent starts and dies in a loop.** `launchctl print gui/$(id -u)/io.github.henrik253.quickdo` shows the last
exit status; `~/Library/Logs/quickdo/quickdo.err.log` has the reason. `ThrottleInterval 5` keeps the loop from
spinning hot. A missing `dist/server.js` means the build never ran: `cd ~/quickdo && npm run build`.

**"Quickdo server is not running on 127.0.0.1:7777".** The CLI or Shortcut could not connect: `quickdo doctor`,
then `quickdo install` (launchd) or `npm start` in the checkout.

**Git push asks for a password under launchd.** Configure a credential helper that works without a TTY
(`gh auth setup-git` or the osxkeychain helper) and push once from a terminal; the server runs git with
`GIT_TERMINAL_PROMPT=0` and reports `offline` instead of hanging.

**Chrome shows the old UI after an update.** The PWA updates on the next open when the capture bar is empty
(prompt mode); force it with **⌘R** in the app window.
