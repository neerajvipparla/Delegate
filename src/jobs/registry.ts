import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Job, JobStatus } from "../types.js";

export function getDelegateHome(): string {
  return process.env.CLAUDE_DELEGATE_HOME ?? join(homedir(), ".claude-delegate");
}

function jobsRoot(): string {
  return join(getDelegateHome(), "jobs");
}

function sessionsRoot(): string {
  return join(getDelegateHome(), "sessions");
}

export function jobDir(jobId: string): string {
  return join(jobsRoot(), jobId);
}

export function jobJsonPath(jobId: string): string {
  return join(jobDir(jobId), "job.json");
}

export function eventsPath(jobId: string): string {
  return join(jobDir(jobId), "events.ndjson");
}

export function stderrPath(jobId: string): string {
  return join(jobDir(jobId), "stderr.log");
}

export function generateJobId(): string {
  return randomUUID();
}

export function createJob(job: Job): void {
  mkdirSync(jobDir(job.jobId), { recursive: true });
  writeFileSync(eventsPath(job.jobId), "");
  writeFileSync(stderrPath(job.jobId), "");
  writeJob(job);
}

export function writeJob(job: Job): void {
  writeFileSync(jobJsonPath(job.jobId), JSON.stringify(job, null, 2));
}

export function readJob(jobId: string): Job | null {
  const path = jobJsonPath(jobId);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Job & { backend?: Job["backend"] };
  return { ...raw, backend: raw.backend ?? "opencode" };
}

export function listJobs(filter?: { status?: JobStatus }, limit?: number): Job[] {
  const root = jobsRoot();
  if (!existsSync(root)) return [];

  const jobs = readdirSync(root)
    .map((jobId) => readJob(jobId))
    .filter((job): job is Job => job !== null)
    .filter((job) => !filter?.status || job.status === filter.status)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return limit ? jobs.slice(0, limit) : jobs;
}

export function indexSession(sessionId: string, jobId: string): void {
  mkdirSync(sessionsRoot(), { recursive: true });
  writeFileSync(join(sessionsRoot(), `${sessionId}.json`), JSON.stringify({ jobId }));
}

export function getJobForSession(sessionId: string): Job | null {
  const path = join(sessionsRoot(), `${sessionId}.json`);
  if (!existsSync(path)) return null;
  const { jobId } = JSON.parse(readFileSync(path, "utf8")) as { jobId: string };
  return readJob(jobId);
}
