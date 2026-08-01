import { readFileSync } from "node:fs";
import { eventsPath } from "../jobs/registry.js";
import { parseEvents } from "../backends/index.js";
import type { Job } from "../types.js";

const OUTPUT_CAP = 8000;

export interface ResultPayload {
  job_id: string;
  backend: Job["backend"];
  status: Job["status"];
  summary: string;
  output: string;
  output_truncated: boolean;
  events_path: string;
  tokens: Job["tokens"];
  cost: Job["cost"];
  session_id: string | null;
  duration_ms: number;
  error: string | null;
}

export function buildResultPayload(job: Job, fullOutput?: boolean): ResultPayload {
  const parsed = parseEvents(readFileSync(eventsPath(job.jobId), "utf8"), job.backend);

  const truncated = !fullOutput && parsed.output.length > OUTPUT_CAP;
  const output = truncated ? parsed.output.slice(0, OUTPUT_CAP) : parsed.output;

  const durationMs =
    parsed.durationMs ??
    (job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt);

  return {
    job_id: job.jobId,
    backend: job.backend,
    status: job.status,
    summary: parsed.summary,
    output,
    output_truncated: truncated,
    events_path: eventsPath(job.jobId),
    tokens: job.tokens,
    cost: job.cost,
    session_id: job.sessionId,
    duration_ms: durationMs,
    error: job.error,
  };
}
