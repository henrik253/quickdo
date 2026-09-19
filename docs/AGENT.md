# quickdo-data — how the agent writes todos

This repository is the data of Quickdo, a personal todo app on one Mac. It holds the live list (`todos.json`),
the schedule, history and an **inbox**. An external LLM agent (called *Hermes* below, `by: "hermes"`) may add and
annotate todos, but only by dropping **new command files into `inbox/`** through the GitHub Contents API. The Mac
ingests them within about a minute, applies them to `todos.json`, deletes the file, and pushes.

**Invariant: one writer per path.** That is what makes conflicts impossible, so the rules below are not optional.

| Path | Writer | The agent may |
|---|---|---|
| `todos.json` | Mac only | read |
| `schedule.json` | Mac only | read (anchors, day window) |
| `history/`, `archive/`, `schema/`, `README.md` | Mac only | read |
| `inbox/<name>.json` | **agent creates**, Mac deletes | create new files only |
| `inbox/rejected/` | Mac only | read (feedback on its own mistakes) |

## Reading state (optional)

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.raw+json" \
     https://api.github.com/repos/henrik253/quickdo-data/contents/todos.json
```

Same for `schedule.json` (anchors = fixed lecture/meeting blocks per weekday) and, for feedback,
`inbox/rejected/` (list the directory with the default `Accept`, then fetch the `*.error.txt` files).

Useful fields in `todos.json` items: `id` (ULID, assigned by the Mac), `title`, `status`
(`open|done|skipped|dropped`), `scheduledFor` (a date = on that day's list; absent = Backlog), `suggestedFor`,
`estimateMin`, `due`, `tags`, `project`, `cue`, `updatedAt`, `source` (`{ kind: "agent", by, ref, dedupeKey }`
for items the agent created).

## Writing a command

One command per file, **PUTs sequential** (never parallel), each file created exactly once.

**Filename grammar** — `^\d{8}T\d{9}Z-[a-z0-9-]{1,40}\.json$`: a UTC timestamp `YYYYMMDDTHHMMSSmmmZ`
(date, `T`, hours minutes seconds milliseconds = 9 digits, `Z`), a dash, a slug of 1–40 lowercase letters, digits or
dashes, `.json`. Lexical order = time order. Examples: `20260918T070300123Z-issue-1-reply.json`,
`20260918T220000000Z-ping.json`. Files over 32 KB, badly named files, directories and non-JSON are rejected.

```bash
NAME="$(date -u +%Y%m%dT%H%M%S)000Z-issue-1-reply.json"
BODY='{"v":1,"op":"add","by":"hermes","at":"2026-09-18T07:03:00Z","item":{"title":"Reply to alice about the meeting slot","estimateMin":10,"due":"2026-09-19","suggestedFor":"2026-09-18","tags":["mail"],"ref":"https://example.com/issues/1","dedupeKey":"issue-1-reply"}}'

curl -s -X PUT -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/henrik253/quickdo-data/contents/inbox/$NAME \
     -d "$(printf '{"message":"inbox: %s","content":"%s"}' "$NAME" "$(printf '%s' "$BODY" | base64)")"
```

`201` = stored. `409` (someone pushed in between) = **re-PUT the same file unchanged**. `422` with
`"sha" wasn't supplied` = a file of that name already exists: pick a new timestamp, never overwrite.

## Command shape

Validated against `schema/inbox-command.schema.json` (strict: **no extra keys anywhere**). Common envelope:

```json
{ "v": 1, "op": "add | update | done | ping", "by": "hermes", "at": "2026-09-18T07:03:00Z" }
```

`v` is always `1`, `by` names the agent, `at` is the UTC instant the command was written. Dates are `YYYY-MM-DD`,
instants ISO 8601.

### `add` — always lands in Backlog

```json
{ "v": 1, "op": "add", "by": "hermes", "at": "2026-09-18T07:03:00Z",
  "item": { "title": "Reply to alice about the meeting slot", "estimateMin": 10, "due": "2026-09-19",
            "suggestedFor": "2026-09-18", "tags": ["mail"], "ref": "https://example.com/issues/1",
            "dedupeKey": "issue-1-reply" } }
```

`item` fields: `title` (required), `note`, `estimateMin`, `due`, `suggestedFor`, `project`, `tags`, `cue`, `ref`
(a URL the UI shows as "hermes ↗"), `dedupeKey`. Always set a stable `dedupeKey` (e.g. `issue-1-reply`,
`mail-<message-id>`): re-sending the same key is a safe no-op (`duplicate`), so retries can never double an item.
`suggestedFor` is a proposal shown as a chip; Henrik accepts it with one key. The item is created with
`status: "open"`, no `scheduledFor`, `source: { "kind": "agent", "by": "hermes", "ref", "dedupeKey" }`.

### `update` — patch an existing item

```json
{ "v": 1, "op": "update", "by": "hermes", "at": "2026-09-18T09:00:00Z",
  "dedupeKey": "issue-1-reply", "baseUpdatedAt": "2026-09-18T07:03:04+02:00",
  "patch": { "note": "alice proposed Friday 14:00", "due": "2026-09-20", "tags": ["mail", "urgent"] } }
```

Target by `id` **or** `dedupeKey` (one of them is required). `patch` may contain only `title, note, due, estimateMin,
project, tags, cue, suggestedFor, ref`. Patches to `title`, `note`, `cue`, `due` or `estimateMin` **must carry
`baseUpdatedAt`** = the `updatedAt` you read from `todos.json`; if Henrik edited the item since, the command is
rejected as `stale: item changed at <ts>` — read again and resend. `ref`, `suggestedFor` and `tags` (merged as a union)
may be patched without `baseUpdatedAt`.

### `done` — mark an item done (needs `baseUpdatedAt`)

```json
{ "v": 1, "op": "done", "by": "hermes", "at": "2026-09-18T18:00:00Z",
  "dedupeKey": "issue-1-reply", "baseUpdatedAt": "2026-09-18T07:03:04+02:00" }
```

Only for items the agent has good reason to believe are finished (e.g. the mail was answered). A stale
`baseUpdatedAt` is rejected; a dropped item answers `gone`; an unknown target `not_found`.

### `ping` — daily heartbeat

```json
{ "v": 1, "op": "ping", "by": "hermes", "at": "2026-09-18T22:00:00Z" }
```

Send one per day even when there is nothing to add. The UI shows "hermes last seen <date>" and turns amber after
7 days of silence, which is how Henrik notices a broken token before it matters.

## What is rejected, and where the feedback is

A file that fails any check is **moved to `inbox/rejected/<name>`** together with `inbox/rejected/<name>.error.txt`
explaining why. Nothing is retried automatically; read the error, fix the command, and PUT a **new** file.

| Error text | Cause |
|---|---|
| `not_a_command_file` | filename does not match the grammar, not a regular file, not JSON, or > 32 KB |
| `schema: <json path>` | shape violation — unknown key, missing `title`, wrong type, bad date, `v` ≠ 1 |
| `duplicate` | `add` with a `dedupeKey` that already exists (harmless; the file is simply removed) |
| `not_found` | `update`/`done` target does not exist (wrong `id`/`dedupeKey`) |
| `gone` | target was dropped |
| `stale: item changed at <ts>` | `baseUpdatedAt` older than the item's `updatedAt` — re-read and resend |

Ingested files are deleted from `inbox/` in the same commit (`ingest: N from hermes (M rejected)`), so an empty
inbox and a new item in `todos.json` with `source.by = "hermes"` is the success signal.

## What the agent may never do

- Modify, rename or delete **any** existing file — not `todos.json`, not an older inbox file, not `rejected/`.
  (Editing a Mac-owned file triggers the Mac's RECOVERY: your change is thrown away and a `conflict/<ts>` branch
  records it; nothing is merged.)
- Invent `id`s. Only the Mac assigns ids (ULIDs); refer to your own items by `dedupeKey`.
- Set `status`, `scheduledFor` or `block` — the daily commitment is Henrik's. Propose with `suggestedFor`.
- Send parallel PUTs, or "fix" a `409` with anything other than re-PUTting the same file.
- Put more than one command into a file, or extra keys anywhere in a command.
- Write personal data of third parties into titles/notes beyond what the task needs.

## Token

A fine-grained personal access token scoped to **this repository only**, permission **Contents: read & write**,
one-year expiry (the expiry date is noted in the Mac's config so the UI warns 14 days ahead). The token is the
agent's only credential; it can never reach the code repository.

## Note for the knowledge vault (template)

> **quickdo-data** (`henrik253/quickdo-data`, private) is Henrik's todo list. To add a todo, PUT one JSON file per
> command into `inbox/` via the Contents API (filename `<UTC timestamp>-<slug>.json`, shape in `README.md` there).
> Never touch `todos.json` or any existing file. Send a `ping` daily. Feedback on rejected commands appears in
> `inbox/rejected/`.
