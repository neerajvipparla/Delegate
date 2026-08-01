import { z } from "zod";
import { listJobs } from "../jobs/registry.js";
import { reconcileJob } from "../jobs/runner.js";

export const listJobsInputShape = {
  status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
  limit: z.number().int().positive().optional(),
};

const listJobsInputSchema = z.object(listJobsInputShape);
type ListJobsInput = z.infer<typeof listJobsInputSchema>;

export async function listJobsHandler(input: ListJobsInput) {
  // Reconcile against current pid/event state *before* filtering by status —
  // a job orphaned by a server restart may actually be "completed" now, and
  // filtering on the stale on-disk "running" status would misplace it.
  const reconciled = listJobs().map(reconcileJob);
  const filtered = input.status ? reconciled.filter((j) => j.status === input.status) : reconciled;
  const limited = input.limit ? filtered.slice(0, input.limit) : filtered;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          jobs: limited.map((j) => ({
            job_id: j.jobId,
            backend: j.backend,
            status: j.status,
            title: j.title,
            started_at: j.startedAt,
            working_directory: j.workingDirectory,
          })),
        }),
      },
    ],
  };
}
