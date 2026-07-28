import { z } from "zod";
import { readFileSync } from "node:fs";
import { readJob, eventsPath } from "../jobs/registry.js";
import { reconcileJob } from "../jobs/runner.js";
import { parseEvents } from "../opencode/events.js";

const OUTPUT_CAP = 8000;

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
  const parsed = parseEvents(readFileSync(eventsPath(input.job_id), "utf8"));

  const truncated = !input.full_output && parsed.output.length > OUTPUT_CAP;
  const output = truncated ? parsed.output.slice(0, OUTPUT_CAP) : parsed.output;

  const durationMs =
    (reconciled.finishedAt ? Date.parse(reconciled.finishedAt) : Date.now()) - Date.parse(reconciled.startedAt);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          job_id: reconciled.jobId,
          status: reconciled.status,
          summary: parsed.summary,
          output,
          output_truncated: truncated,
          events_path: eventsPath(input.job_id),
          tokens: reconciled.tokens,
          cost: reconciled.cost,
          session_id: reconciled.sessionId,
          duration_ms: durationMs,
          error: reconciled.error,
        }),
      },
    ],
  };
}

function notFound(jobId: string) {
  return { content: [{ type: "text" as const, text: `job not found: ${jobId}` }], isError: true };
}
