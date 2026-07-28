import { z } from "zod";
import { readJob } from "../jobs/registry.js";
import { reconcileJob } from "../jobs/runner.js";

export const checkStatusInputShape = { job_id: z.string() };

const checkStatusInputSchema = z.object(checkStatusInputShape);
type CheckStatusInput = z.infer<typeof checkStatusInputSchema>;

export async function checkStatusHandler(input: CheckStatusInput) {
  const job = readJob(input.job_id);
  if (!job) {
    return notFound(input.job_id);
  }
  const reconciled = reconcileJob(job);
  const elapsedMs =
    (reconciled.finishedAt ? Date.parse(reconciled.finishedAt) : Date.now()) - Date.parse(reconciled.startedAt);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          job_id: reconciled.jobId,
          status: reconciled.status,
          session_id: reconciled.sessionId,
          started_at: reconciled.startedAt,
          finished_at: reconciled.finishedAt,
          elapsed_ms: elapsedMs,
        }),
      },
    ],
  };
}

function notFound(jobId: string) {
  return { content: [{ type: "text" as const, text: `job not found: ${jobId}` }], isError: true };
}
