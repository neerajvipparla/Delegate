import { z } from "zod";
import { cancelJob } from "../jobs/runner.js";

export const cancelJobInputShape = { job_id: z.string() };

const cancelJobInputSchema = z.object(cancelJobInputShape);
type CancelJobInput = z.infer<typeof cancelJobInputSchema>;

export async function cancelJobHandler(input: CancelJobInput) {
  try {
    const job = cancelJob(input.job_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: job.jobId, status: job.status }) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
}
