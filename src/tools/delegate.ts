import { z } from "zod";
import { spawnJob } from "../jobs/runner.js";
import { generateJobId } from "../jobs/registry.js";
import { validateDelegateRequest } from "./validateDelegate.js";

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

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ job_id: job.jobId, status: job.status, started_at: job.startedAt }),
      },
    ],
  };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
