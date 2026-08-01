import { z } from "zod";
import { spawnJob } from "../jobs/runner.js";
import { generateJobId, readJob } from "../jobs/registry.js";
import { validateDelegateRequest } from "./validateDelegate.js";
import type { Job } from "../types.js";

export const delegateInputShape = {
  prompt: z.string().min(1),
  working_directory: z.string().min(1),
  backend: z.enum(["opencode", "cursor"]).optional(),
  title: z.string().optional(),
  session_id: z.string().optional(),
  fork: z.boolean().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  mode: z.enum(["plan", "ask"]).optional(),
};

const delegateInputSchema = z.object(delegateInputShape);
type DelegateInput = z.infer<typeof delegateInputSchema>;

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
      backend: validation.backend,
      title: input.title,
      sessionId: input.session_id,
      fork: input.fork,
      model: input.model,
      agent: input.agent,
      mode: input.mode,
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
          backend: current.backend,
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
