# Quick todo from anywhere — the ⌃⌥Space Shortcut

A six-step macOS Shortcut that captures a todo into Quickdo from any app. It talks to the local
server (`http://127.0.0.1:7777`), so the server must be running (`quickdo doctor` checks).

## The recipe ("Quick todo")

Open **Shortcuts.app** → **+** (new shortcut) → name it **Quick todo** → add these actions in order:

| # | Action (search box) | Settings |
|---|---|---|
| 1 | **Ask for Input** | Prompt: `Todo` · Input type: Text · leave the default empty |
| 2 | **Text** | `{"text": "<Provided Input>", "source": "hotkey"}` — insert the *Provided Input* variable from step 1 between the quotes (tap the field, pick the variable) |
| 3 | **Get Contents of URL** | URL: `http://127.0.0.1:7777/api/capture` · Method: **POST** · Headers: `Content-Type` = `application/json`, `X-Quickdo-Client` = `1` · Request Body: **File** → the *Text* from step 2 |
| 4 | **Get Dictionary from Input** | input: *Contents of URL* |
| 5 | **Get Dictionary Value** | Get **Value** for key `item` → then a second **Get Dictionary Value** for key `title` (or use the key path `item.title` if your macOS version supports it) |
| 6 | **Show Notification** | Title: `Added to Quickdo` · Body: the *Dictionary Value* from step 5 |

Then, in the shortcut's **details** (ⓘ in the sidebar):

- Tick **Pin in Menu Bar** (optional) and **Use as Quick Action** (no input needed).
- **Add Keyboard Shortcut** → press **⌃⌥Space** (Control + Option + Space).

The quick syntax works exactly as in the app: `Read paper X !today ~30m #thesis`, `Reply to alice @14 ~15m`,
`Lecture A notes !tmr`. Without a `!` token the item lands in Backlog (docs/PLAN.md D8).

## Verifying it

1. Start the server (`quickdo doctor` says `ok server on http://127.0.0.1:7777`).
2. Press ⌃⌥Space from another app, type `Read paper X !today`, press Return.
3. A notification "Added to Quickdo — Read paper X" appears and the row is in the open window (SSE) within a second.

If step 3 shows an error instead:

- `Could not connect` → the server is not running: `quickdo install` (launchd) or `npm start` in the checkout.
- HTTP 403 → the two headers are missing or misspelled (`X-Quickdo-Client: 1` is mandatory, docs/PLAN.md D17).
- HTTP 415 → the `Content-Type` header is not `application/json`.
- HTTP 400 → the text had no title (only tokens).

## One-liner for any launcher

Raycast, Alfred, a terminal alias, Automator — anything that can run a shell command:

```bash
curl -s -X POST http://127.0.0.1:7777/api/capture \
  -H 'Content-Type: application/json' -H 'X-Quickdo-Client: 1' \
  -d '{"text":"Read paper X !today","source":"hotkey"}'
```

Or simply `quickdo "Read paper X !today"` if `bin/quickdo` is on your PATH (see `docs/SETUP.md`).
