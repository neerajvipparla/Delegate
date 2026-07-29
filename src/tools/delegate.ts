import { z } from "zod";
import { spawnJob } from "../jobs/runner.js";
import { generateJobId, readJob } from "../jobs/registry.js";
import { validateDelegateRequest } from "./validateDelegate.js";
import type { Job } from "../types.js";

export const delegateInputShape = {
  prompt: z.string().min(1),
  working_directory: z.string().min(1),
  title: z.string().optional(),
  session_id: z.string().optional(),
  fork: z.boolean().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
};

const delegateInputSchema = z.object(delegateInputShape);
type DelegateInput = z.infer<typeof delegateInputSchema>;

// How long delegate() waits for OpenCode's session_id to appear before
// returning anyway. Confirmed empirically against the real opencode CLI:
// time-to-first-event (step_start, which carries the sessionID) varied
// from ~1s to ~5s across otherwise-identical trivial prompts -- likely
// process startup plus provider connection/first-token latency, not
// something under this server's control. 8s gives real margin above the
// observed worst case while staying well under delegate_sync's typical
// wait times. If it's still not there when the bound is hit, session_id is
// just null; the caller can get it later via check_status once OpenCode
// actually starts responding.
const SESSION_ID_WAIT_MS = 8000;
const SESSION_ID_POLL_INTERVAL_MS = 250;

export async function delegateHandler(
  input: DelegateInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const validation = validateDelegateRequest(input);
  if (!validation.ok) {
    return errorResult(validation.error);
  }

  const jobId = generateJobId();
  const job = spawnJob(
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

  const current = (await waitForSessionId(jobId)) ?? job;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          job_id: current.jobId,
          status: current.status,
          started_at: current.startedAt,
          session_id: current.sessionId,
        }),
      },
    ],
  };
}

async function waitForSessionId(jobId: string): Promise<Job | null> {
  const start = Date.now();
  while (Date.now() - start < SESSION_ID_WAIT_MS) {
    const current = readJob(jobId);
    if (!current) return null;
    if (current.sessionId || current.status !== "running") {
      return current;
    }
    await sleep(SESSION_ID_POLL_INTERVAL_MS);
  }
  return readJob(jobId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
