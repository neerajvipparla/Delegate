import { z } from "zod";
import { readJob } from "../jobs/registry.js";
import { reconcileJob } from "../jobs/runner.js";
import { buildResultPayload } from "../opencode/resultPayload.js";

export const getResultInputShape = {
  job_id: z.string(),
  full_output: z.boolean().optional(),
};

const getResultInputSchema = z.object(getResultInputShape);
type GetResultInput = z.infer<typeof getResultInputSchema>;

export async function getResultHandler(input: GetResultInput) {
  const job = readJob(input.job_id);
  if (!job) {
    return notFound(input.job_id);
  }
  const reconciled = reconcileJob(job);
  const payload = buildResultPayload(reconciled, input.full_output);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function notFound(jobId: string) {
  return { content: [{ type: "text" as const, text: `job not found: ${jobId}` }], isError: true };
}
