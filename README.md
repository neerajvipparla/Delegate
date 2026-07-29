# claude-delegate

An MCP server that gives Claude Code a `delegate()` tool to hand a task to
the [OpenCode](https://opencode.ai) CLI as a background job, with polling,
results, listing, and cancellation.

## Requirements

- Node.js >= 18
- The `opencode` CLI installed, authenticated, and on `PATH`

## Install

    npm install
    npm run build

## Register with Claude Code

    claude mcp add claude-delegate -s user -- node /absolute/path/to/claude-delegate/dist/server.js

## Tools

> **Every delegated run passes `--auto` to OpenCode.** This auto-approves
> file writes and shell command execution inside the target
> `working_directory` — OpenCode will not pause to ask for permission before
> making changes. Only point this tool at a repository you're comfortable
> having modified unattended.

- `delegate(prompt, working_directory, title?, session_id?, fork?, model?, agent?)`
  — starts an OpenCode run in the background, returns `{ job_id, status, started_at }`.
- `delegate_sync(prompt, working_directory, title?, session_id?, fork?, model?, agent?, max_wait_ms?, stall_timeout_ms?)`
  — like `delegate()`, but waits for the job to finish and returns the final result directly (same shape as `get_result`).
  If `max_wait_ms` (default 5 minutes) elapses while the job is still healthy, falls back to
  `{ job_id, status: "running", timed_out: true }` — the job keeps running, use `check_status`/`get_result` to
  keep tracking it. If opencode produces no new output for `stall_timeout_ms` (default 30s), the job is
  cancelled and the result includes `stalled: true`.
- `check_status(job_id)` — cheap status poll.
- `get_result(job_id, full_output?)` — structured summary, output, tokens, cost.
- `list_jobs(status?, limit?)` — list known jobs, newest first.
- `cancel_job(job_id)` — terminate a running job.

Continuing a session (`session_id`) requires the same `working_directory` as
the original call. OpenCode sessions are directory-scoped, and continuing
one from a different directory hangs indefinitely rather than failing, so
`delegate()` rejects the mismatch up front instead of letting that happen.

## Development

    npm test                             # unit + fake-opencode integration tests
    RUN_REAL_OPENCODE_TESTS=1 npm test   # also runs one real opencode call (spends tokens)

Job state lives under `~/.claude-delegate/` (override with `CLAUDE_DELEGATE_HOME`).
