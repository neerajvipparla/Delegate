import { z } from "zod";
import { statSync } from "node:fs";
import { spawnJob, cancelJob } from "../jobs/runner.js";
import { generateJobId, readJob, eventsPath } from "../jobs/registry.js";
import { validateDelegateRequest } from "./validateDelegate.js";
import { buildResultPayload } from "../opencode/resultPayload.js";
import type { Job } from "../types.js";

export const delegateSyncInputShape = {
  prompt: z.string().min(1),
  working_directory: z.string().min(1),
  title: z.string().optional(),
  session_id: z.string().optional(),
  fork: z.boolean().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  max_wait_ms: z.number().int().positive().optional(),
  stall_timeout_ms: z.number().int().positive().optional(),
};

const delegateSyncInputSchema = z.object(delegateSyncInputShape);
type DelegateSyncInput = z.infer<typeof delegateSyncInputSchema>;

const DEFAULT_MAX_WAIT_MS = 300_000; // 5 minutes
// OpenCode's --format json mode emits nothing while a tool call is in
// progress -- confirmed empirically with a 40-second shell command that
// produced zero NDJSON output until it completed. "No new events" is
// therefore a weak signal for "hung": it can't be distinguished from a
// long-running build/test/install. Default high (10 minutes) so this is a
// backstop against a genuinely dead process, not a limiter on normal tool
// call duration -- under default settings, max_wait_ms's non-destructive
// fallback (still running, keep tracking it) fires well before this does.
const DEFAULT_STALL_TIMEOUT_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 200;

export async function delegateSyncHandler(
  input: DelegateSyncInput,
  extra?: { signal?: AbortSignal }
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const validation = validateDelegateRequest(input);
  if (!validation.ok) {
    return errorResult(validation.error);
  }

  const maxWaitMs = input.max_wait_ms ?? DEFAULT_MAX_WAIT_MS;
  const stallTimeoutMs = input.stall_timeout_ms ?? DEFAULT_STALL_TIMEOUT_MS;

  const jobId = generateJobId();
  spawnJob(
    {
      prompt: input.prompt,
      workingDirectory: validation.workingDirectory,
      title: input.title,
      sessionId: input.session_id,
      fork: input.fork,
      model: input.model,
      agent: input.agent,
    },
    jobId
  );

  const start = Date.now();
  let lastEventsSize = -1;
  let lastProgressAt = Date.now();

  while (true) {
    await sleep(POLL_INTERVAL_MS);

    const current = readJob(jobId);
    if (!current) {
      return errorResult(`job disappeared during wait: ${jobId}`);
    }

    if (extra?.signal?.aborted) {
      // The caller gave up on this request (client timeout or user
      // interrupt) -- never kill the job just because nobody is waiting
      // for it anymore. It keeps running; the caller can pick it back up
      // with check_status/get_result using the job_id. session_id is
      // included (if known yet) so the caller can also inspect the live
      // OpenCode session directly rather than only polling job_id.
      return jsonResult({ job_id: jobId, status: "running", aborted: true, session_id: current.sessionId });
    }

    if (current.status !== "running") {
      return jsonResult(buildResultPayload(current));
    }

    const size = currentEventsSize(jobId);
    if (size !== lastEventsSize) {
      lastEventsSize = size;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt >= stallTimeoutMs) {
      let cancelled: Job;
      try {
        cancelled = cancelJob(jobId);
      } catch {
        return errorResult(`job disappeared during wait: ${jobId}`);
      }
      if (cancelled.status !== "cancelled") {
        // The job actually finished (or was cancelled by someone else)
        // in the narrow window between our stall check and this call --
        // report what really happened, not a fabricated stall.
        return jsonResult(buildResultPayload(cancelled));
      }
      const payload = buildResultPayload(cancelled);
      return jsonResult({
        ...payload,
        stalled: true,
        error: payload.error ?? `opencode produced no new output for ${stallTimeoutMs}ms and was cancelled`,
      });
    }

    if (Date.now() - start >= maxWaitMs) {
      return jsonResult({ job_id: jobId, status: "running", timed_out: true, session_id: current.sessionId });
    }
  }
}

function currentEventsSize(jobId: string): number {
  try {
    return statSync(eventsPath(jobId)).size;
  } catch {
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
