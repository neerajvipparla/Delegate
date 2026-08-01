# claude-delegate

An MCP server that gives Claude Code `delegate()` tools to hand a task to **OpenCode** or **Cursor** as a background job, with polling, results, listing, and cancellation. Claude picks the backend from the user's request (see `skills/claude-delegate/SKILL.md`); end users do not set backend flags.

## Command surface

Six MCP tools, registered in `src/server.ts`. Parameters are taken from the Zod schemas in `src/tools/*.ts`.

- `delegate(prompt, working_directory, backend?, title?, session_id?, fork?, model?, agent?, mode?)`
- `delegate_sync(prompt, working_directory, backend?, title?, session_id?, fork?, model?, agent?, mode?, max_wait_ms?, stall_timeout_ms?)`
- `check_status(job_id)`
- `get_result(job_id, full_output?)`
- `list_jobs(status?, limit?)`
- `cancel_job(job_id)`

Parameter types:

| Parameter | Type | Tools |
|---|---|---|
| `prompt` | string (required) | `delegate`, `delegate_sync` |
| `working_directory` | string (required) | `delegate`, `delegate_sync` |
| `backend` | `"opencode" \| "cursor"` (optional, default `opencode`) | `delegate`, `delegate_sync` — set by Claude from user intent, not by the user directly |
| `title` | string (optional) | `delegate`, `delegate_sync` |
| `session_id` | string (optional) | `delegate`, `delegate_sync` |
| `fork` | boolean (optional) | `delegate`, `delegate_sync` |
| `model` | string (optional) | `delegate`, `delegate_sync` |
| `agent` | string (optional, opencode only) | `delegate`, `delegate_sync` |
| `mode` | `"plan" \| "ask"` (optional, cursor only) | `delegate`, `delegate_sync` |
| `max_wait_ms` | positive integer (optional) | `delegate_sync` |
| `stall_timeout_ms` | positive integer (optional) | `delegate_sync` |
| `job_id` | string (required) | `check_status`, `get_result`, `cancel_job` |
| `full_output` | boolean (optional) | `get_result` |
| `status` | `"running" \| "completed" \| "failed" \| "cancelled"` (optional) | `list_jobs` |
| `limit` | positive integer (optional) | `list_jobs` |

## Install

```bash
npm install
npm run build
```

Then register the built server with Claude Code (replace the path):

```bash
claude mcp add claude-delegate -s user -- node /absolute/path/to/claude-delegate/dist/server.js
```

## Usage / typical flow

> **Warning:** every delegated run auto-approves file writes and shell commands inside `working_directory` — OpenCode via `--auto`, Cursor via `--force`. Only delegate into a directory you're comfortable having modified unattended.

### `delegate` — fire and forget

Waits briefly (up to 8s) for OpenCode's `session_id` to become available before returning, so the caller has something to open/inspect right away instead of only an opaque job ID — confirmed empirically that real OpenCode's time-to-first-event can take several seconds, so this is a best-effort wait, not a guarantee:

```json
{ "job_id": "...", "backend": "opencode", "status": "running", "started_at": "2026-07-29T...", "session_id": "ses_..." }
```

If OpenCode is unusually slow to start, `session_id` may still be `null` here — poll `check_status(job_id)` shortly after to pick it up once it appears. Poll `check_status(job_id)` until `status` is no longer `"running"`, then call `get_result(job_id)` for the structured payload.

### `delegate_sync` — wait inline

Same underlying job as `delegate`, but blocks until the job finishes or one of the safety limits below fires. When the job finishes, it returns the same payload as `get_result`.

### `get_result` payload shape

`get_result` returns JSON with these fields (from `src/opencode/resultPayload.ts`):

```json
{
  "job_id": "...",
  "backend": "opencode | cursor",
  "status": "completed | failed | cancelled | running",
  "summary": "...",
  "output": "...",
  "output_truncated": false,
  "events_path": "...",
  "tokens": { "total": ..., "input": ..., "output": ..., "reasoning": ..., "cache": { "write": ..., "read": ... } },
  "cost": 0.0,
  "session_id": "...",
  "duration_ms": 1234,
  "error": null
}
```

OpenCode jobs populate `tokens` and `cost` from `step_finish` events. Cursor jobs return `tokens: null` and `cost: null` (the Cursor CLI stream format does not include usage). Output is capped at 8000 characters unless you pass `full_output: true`.

### `list_jobs` and `cancel_job`

Use `list_jobs(status?, limit?)` to see known jobs, newest first. Use `cancel_job(job_id)` to terminate a running job.

## How it works

**Backends.** `src/backends/` implements OpenCode (`opencode run --format json --auto`) and Cursor (`agent -p --force --output-format stream-json`). The job runner (`src/jobs/runner.ts`) spawns either CLI as a detached process and parses NDJSON events from `events.ndjson`.

**Auto-approval.** OpenCode uses `--auto`; Cursor uses `--force`. Both mean unattended file writes and shell in `working_directory`.

**Session directory-scoping.** Sessions are scoped to a directory and backend. Continuing a session from a different `working_directory` or backend is rejected up front (`src/tools/validateDelegate.ts`).

**`delegate_sync`'s three non-completed outcomes.** Besides returning the final result when the job finishes, `delegate_sync` can return:

1. `{ status: "running", timed_out: true, job_id, session_id }` — `max_wait_ms` elapsed while the job was still healthy. The job is **not** cancelled; pick it up later with `check_status`/`get_result`. Default `max_wait_ms` is 300,000 ms (5 minutes).
2. `{ status: "running", aborted: true, job_id, session_id }` — the MCP request itself was cancelled (client timeout or interrupt). The job is **not** cancelled; pick it up later with the returned `job_id`.
3. `{ status: "cancelled", stalled: true, ... }` — the worker produced no new output for `stall_timeout_ms`, so the server killed it as presumed-hung.

**Why the stall timeout defaults to 10 minutes.** Both backends emit nothing while a tool call is in progress.

## Known limitations

- **OpenCode:** requires `opencode` on `PATH` (or `OPENCODE_BIN`), authenticated.
- **Cursor:** requires `agent` on `PATH` (or `CURSOR_AGENT_BIN`), plus `CURSOR_API_KEY` or `agent login`.
- Job state lives on the machine running the MCP server, under `~/.claude-delegate/` (override with `CLAUDE_DELEGATE_HOME`).
- No push notifications when a job finishes.
- `get_result` truncates `output` to 8000 characters unless `full_output: true`.
- Continuing a session requires the same backend and working directory.
- Cursor jobs do not report token usage or cost in the CLI stream output.

## Development

```bash
npm test                             # unit + fake backend integration tests
RUN_REAL_OPENCODE_TESTS=1 npm test   # also runs one real opencode call (spends tokens)
```

## Logging

Logging is **off by default**. To enable it, edit `config.json` at the repo root:

```json
{ "logging": { "enabled": true, "port": 4599 } }
```

When enabled, the server writes structured NDJSON logs to a single shared file
`~/.claude-delegate/logs/server.log` (all sessions append to it; the `pid`
field identifies which server process wrote each line) and serves them live at
`http://127.0.0.1:<port>`. The viewer has a per-session filter so you can
isolate a single delegation's logs by its OpenCode `session_id`.

Each line is one JSON object with `ts`, `level`, `pid`, `event`
(`server_start` / `tool_call` / `tool_result` / `job_spawned` /
`job_finalized` / `job_cancelled` / `error`), `msg`, and event-specific
fields (`session_id`, `job_id`, `tool`, `working_directory`,
`prompt_preview` (truncated), `status`, `exit_code`, `duration_ms`, `cost`,
`error`).

Because every Claude Code session spawns its own server process, only one
process binds the viewer port — and because the log file is shared, that one
viewer shows every session's logs. If the process that owns the port exits
while other sessions are open, the live view is unavailable until a new
session rebinds it; the file keeps recording throughout. The config path can
be overridden with the `CLAUDE_DELEGATE_CONFIG` environment variable.
