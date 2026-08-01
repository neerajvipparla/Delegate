import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJob,
  readJob,
  writeJob,
  listJobs,
  indexSession,
  getJobForSession,
  generateJobId,
} from "../src/jobs/registry.js";
import type { Job } from "../src/types.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: generateJobId(),
    backend: "opencode",
    status: "running",
    pid: 1234,
    pidStartedAt: null,
    workingDirectory: "/tmp/proj",
    prompt: "do a thing",
    title: null,
    sessionId: null,
    model: null,
    agent: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    tokens: null,
    cost: null,
    ...overrides,
  };
}

let currentDir: string;

beforeEach(() => {
  currentDir = mkdtempSync(join(tmpdir(), "claude-delegate-test-"));
  process.env.CLAUDE_DELEGATE_HOME = currentDir;
});

afterEach(() => {
  rmSync(currentDir, { recursive: true, force: true });
});

test("creates and reads back a job", () => {
  const job = makeJob();
  createJob(job);
  assert.deepEqual(readJob(job.jobId), job);
});

test("returns null for an unknown job id", () => {
  assert.equal(readJob("nope"), null);
});

test("writeJob overwrites an existing job's fields", () => {
  const job = makeJob();
  createJob(job);
  writeJob({ ...job, status: "completed", exitCode: 0 });
  const read = readJob(job.jobId);
  assert.equal(read?.status, "completed");
  assert.equal(read?.exitCode, 0);
});

test("listJobs returns newest first and respects status filter", () => {
  const older = makeJob({ status: "completed", startedAt: "2026-01-01T00:00:00.000Z" });
  const newer = makeJob({ status: "running", startedAt: "2026-01-02T00:00:00.000Z" });
  createJob(older);
  createJob(newer);

  assert.deepEqual(listJobs().map((j) => j.jobId), [newer.jobId, older.jobId]);
  assert.deepEqual(listJobs({ status: "running" }).map((j) => j.jobId), [newer.jobId]);
});

test("listJobs respects limit", () => {
  createJob(makeJob({ startedAt: "2026-01-01T00:00:00.000Z" }));
  createJob(makeJob({ startedAt: "2026-01-02T00:00:00.000Z" }));
  createJob(makeJob({ startedAt: "2026-01-03T00:00:00.000Z" }));
  assert.equal(listJobs(undefined, 2).length, 2);
});

test("listJobs returns an empty array when no jobs exist yet", () => {
  assert.deepEqual(listJobs(), []);
});

test("indexes a session id to its job and looks it back up", () => {
  const job = makeJob({ sessionId: "ses_abc" });
  createJob(job);
  indexSession("ses_abc", job.jobId);
  assert.equal(getJobForSession("ses_abc")?.jobId, job.jobId);
});

test("getJobForSession returns null for an unindexed session", () => {
  assert.equal(getJobForSession("ses_unknown"), null);
});
