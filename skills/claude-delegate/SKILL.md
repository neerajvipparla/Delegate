---
name: claude-delegate
description: Use when the claude-delegate MCP server's tools (delegate, delegate_sync, check_status, get_result, list_jobs, cancel_job) are available and you want to hand a coding or research task off to OpenCode instead of doing it yourself
---

# Using claude-delegate

claude-delegate gives you six tools to run OpenCode as a background worker
against a target `working_directory`, instead of doing the work yourself.
You stay the orchestrator: delegate the task, get a structured result back
(summary, output, tokens, cost), and continue reasoning with it.

## Before you delegate anything

**Every delegated run passes `--auto` to OpenCode.** This auto-approves
file writes and shell command execution inside `working_directory` —
OpenCode does not pause to ask permission. Only delegate into a directory
you're comfortable being modified unattended. If you're not sure the user
wants unattended file changes in a given repo, ask before delegating there,
the same way you'd ask before running a destructive command yourself.

## Picking `delegate` vs `delegate_sync`

Both start the same underlying OpenCode job. The difference is only in how
you get the result back.

- **`delegate_sync`** — use this by default for a single, bounded task where
  you want the result inline and don't need to do other work while it runs.
  It blocks until the job finishes (or one of two safety limits below is
  hit) and hands you the final result directly — no manual polling loop.
- **`delegate`** — use this when you want to keep working on something else
  while OpenCode runs, or when you're fanning out several tasks in parallel
  (dispatch multiple `delegate()` calls, then poll each with
  `check_status`/`get_result` as you get to them). `delegate` returns
  quickly with `{ job_id, status: "running", started_at, session_id }` — it
  waits briefly (up to 8s) for OpenCode's `session_id` to show up before
  returning, so you have something to inspect right away instead of only a
  job ID (`session_id` can still be `null` if OpenCode is unusually slow to
  start — real time-to-first-event varies from ~1s to ~5s+, so this is
  best-effort, not guaranteed). You are responsible for checking back on
  the job. Nothing pushes a notification; if you don't poll, the job runs
  to completion in the background and its result just sits there unread.

If you're unsure which to use, default to `delegate_sync` — it's strictly
easier to use correctly.

## `delegate_sync`'s four possible outcomes

Don't assume `delegate_sync` always returns a finished result — check
`status` (and the extra boolean fields) before treating the response as
final:

1. **`status: "completed"` or `"failed"`** — the job actually finished.
   Same shape as `get_result`: `summary`, `output` (capped at 8000 chars
   unless you pass `full_output: true`), `tokens`, `cost`, `error`. This is
   the common case for short-to-medium tasks.
2. **`status: "running"`, `timed_out: true`** — the job was still healthy
   but took longer than `max_wait_ms` (default 5 minutes). **The job was
   NOT killed** — it's still running. You get a `job_id` and (usually)
   `session_id`; follow up later with `check_status(job_id)` /
   `get_result(job_id)` instead of re-delegating the same task.
3. **`status: "running"`, `aborted: true`** — your own request got
   cancelled (rare — usually means something interrupted you, not
   something you need to handle explicitly; this is also what happens if
   your own client moves a slow tool call to the background). Same as
   above: the job is still running, use the returned `job_id` to check on
   it later.
4. **`status: "cancelled"`, `stalled: true`** — OpenCode produced no new
   output for `stall_timeout_ms` (default 10 minutes) and was killed as
   presumed-hung. This default is deliberately high: OpenCode emits
   nothing at all while a tool call is in progress, so a long build, test
   suite, or install can legitimately go silent for many minutes without
   being stuck. If you're delegating something you know is short and
   tool-call-light, you can pass a smaller `stall_timeout_ms` for faster
   dead-process detection — but don't set it low for anything that might
   run a real build/test/install, or you'll kill healthy work.

## Continuing a session

Pass the `session_id` from a prior result (or from `check_status`) to
continue the same OpenCode conversation instead of starting fresh. **The
`working_directory` must be identical to the original call.** OpenCode
sessions are directory-scoped; continuing one from a different directory
doesn't fail cleanly, it hangs — so this server rejects the mismatch itself
before it can happen. If you get an error like `session_id ... was created
in X, not Y`, use the original directory.

## Manual polling with `delegate`

If you use `delegate` instead of `delegate_sync`, the follow-up loop looks
like:

1. `delegate(...)` → note the `job_id`.
2. Do other work, or wait a bit.
3. `check_status(job_id)` — cheap, tells you `status` without building the
   full result payload. Use this if you just want to know "is it done yet."
4. Once `status` isn't `"running"`, call `get_result(job_id)` for the full
   payload — or call `get_result` directly at any point, even mid-run, if
   you want to peek at partial output (it works while `status: "running"`
   too, just with whatever's been produced so far).
5. `list_jobs(status?, limit?)` if you've lost track of what's running.
6. `cancel_job(job_id)` if you no longer need a running job's result —
   don't just abandon it if it's doing something you don't want to happen
   (e.g. mid-write under `--auto`).

## Troubleshooting

- **"opencode binary not found"** — the `opencode` CLI isn't on `PATH` (or
  `OPENCODE_BIN`) in the environment running this MCP server. Not something
  you can fix from inside a conversation; tell the user.
- **A job seems stuck at `status: "running"` forever** — check
  `get_result(job_id)` for partial output first (did it actually start?),
  then `cancel_job(job_id)` if you conclude it's not going to finish. Job
  state lives under `~/.claude-delegate/` on the machine running the
  server (`CLAUDE_DELEGATE_HOME` if overridden).
- **A `delegate_sync` call you expected to be quick came back
  `timed_out: true`** — that's normal for anything that legitimately takes
  longer than 5 minutes; don't re-delegate the same prompt, just poll the
  returned `job_id`.
- **"Where can I watch what OpenCode is doing live?"** — if the user has
  enabled logging (off by default; set `logging.enabled: true` in the repo's
  `config.json`), a live view of all sessions is at `http://127.0.0.1:<port>`
  (default port 4599), with a per-session filter. The same events are in
  `~/.claude-delegate/logs/server.log` as NDJSON.
