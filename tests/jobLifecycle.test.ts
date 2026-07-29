import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnJob, reconcileJob, cancelJob, isPidLikelyOurs } from "../src/jobs/runner.js";
import { readJob, eventsPath, jobDir, generateJobId, createJob } from "../src/jobs/registry.js";
import type { Job } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_OPENCODE = join(__dirname, "fixtures", "fake-opencode.mjs");

let homeDir: string;
let workDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "claude-delegate-home-"));
  workDir = mkdtempSync(join(tmpdir(), "claude-delegate-work-"));
  process.env.CLAUDE_DELEGATE_HOME = homeDir;
  process.env.OPENCODE_BIN = FAKE_OPENCODE;
  process.env.CANCEL_GRACE_MS = "200"; // keep the SIGKILL-escalation test fast; same value for every test in this file
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

async function waitForStatus(jobId: string, notStatus: string, timeoutMs = 3000): Promise<Job> {
  const start = Date.now();
  let job = readJob(jobId)!;
  while (job.status === notStatus) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting past status ${notStatus}`);
    await new Promise((r) => setTimeout(r, 25));
    job = readJob(jobId)!;
  }
  return job;
}

test("spawnJob runs a job to completion", async () => {
  const jobId = generateJobId();
  spawnJob({ prompt: "hello", workingDirectory: workDir }, jobId);

  const finished = await waitForStatus(jobId, "running");
  assert.equal(finished.status, "completed");
  assert.equal(finished.exitCode, 0);
  assert.ok(finished.sessionId?.startsWith("ses_fake_"));
  assert.equal(finished.tokens?.total, 10);

  const events = readFileSync(eventsPath(jobId), "utf8");
  assert.match(events, /echo: hello/);
});

test("spawnJob patches session_id onto the job before it finishes", async () => {
  const jobId = generateJobId();
  spawnJob({ prompt: "MODE=hang||hello", workingDirectory: workDir }, jobId);

  const start = Date.now();
  let job = readJob(jobId)!;
  while (!job.sessionId) {
    if (Date.now() - start > 3000) throw new Error("session id never appeared");
    await new Promise((r) => setTimeout(r, 25));
    job = readJob(jobId)!;
  }
  assert.ok(job.sessionId.startsWith("ses_fake_"));
  assert.equal(job.status, "running");

  cancelJob(jobId);
});

test("spawnJob marks a non-zero exit as failed with the stderr tail as error", async () => {
  const jobId = generateJobId();
  spawnJob({ prompt: "MODE=fail||boom", workingDirectory: workDir }, jobId);

  const finished = await waitForStatus(jobId, "running");
  assert.equal(finished.status, "failed");
  assert.equal(finished.exitCode, 1);
  assert.match(finished.error ?? "", /simulated failure/);
});

test("cancelJob terminates a running job and marks it cancelled", async () => {
  const jobId = generateJobId();
  const job = spawnJob({ prompt: "MODE=hang||run forever", workingDirectory: workDir }, jobId);
  assert.ok(job.pid);

  const start = Date.now();
  while (!readJob(jobId)!.pid) {
    if (Date.now() - start > 2000) throw new Error("pid never recorded");
    await new Promise((r) => setTimeout(r, 25));
  }

  const cancelled = cancelJob(jobId);
  assert.equal(cancelled.status, "cancelled");

  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(job.pid!, 0));
});

test("cancelJob's status survives the signaled process's exit event (regression)", async () => {
  // cancelJob writes status "cancelled" synchronously, before the SIGTERM is even
  // delivered. When the signaled child later exits, Node reports exitCode === null
  // (processes killed by a signal get a null exit code), and finalizeJob must not
  // reinterpret that null as a failure and clobber the "cancelled" status.
  const jobId = generateJobId();
  const job = spawnJob({ prompt: "MODE=hang||run forever", workingDirectory: workDir }, jobId);
  assert.ok(job.pid);

  const start = Date.now();
  while (!readJob(jobId)!.pid) {
    if (Date.now() - start > 2000) throw new Error("pid never recorded");
    await new Promise((r) => setTimeout(r, 25));
  }

  const cancelled = cancelJob(jobId);
  assert.equal(cancelled.status, "cancelled");

  // Wait for the process to actually die from the SIGTERM.
  const deathStart = Date.now();
  while (true) {
    try {
      process.kill(job.pid!, 0);
    } catch {
      break;
    }
    if (Date.now() - deathStart > 2000) throw new Error("process never died");
    await new Promise((r) => setTimeout(r, 25));
  }

  // Give the child's "exit" event handler (finalizeJob) a moment to run and
  // (incorrectly, pre-fix) overwrite job.json.
  await new Promise((r) => setTimeout(r, 200));

  const final = readJob(jobId)!;
  assert.equal(final.status, "cancelled");
});

test("cancelJob escalates to SIGKILL when the process ignores SIGTERM", async () => {
  const jobId = generateJobId();
  const job = spawnJob({ prompt: "MODE=hang-ignore-sigterm||run forever", workingDirectory: workDir }, jobId);
  assert.ok(job.pid);

  const start = Date.now();
  while (!readJob(jobId)!.pid) {
    if (Date.now() - start > 2000) throw new Error("pid never recorded");
    await new Promise((r) => setTimeout(r, 25));
  }

  cancelJob(jobId);

  // CANCEL_GRACE_MS=200 (set in beforeEach) plus a buffer for the SIGKILL to land.
  await new Promise((r) => setTimeout(r, 700));
  assert.throws(() => process.kill(job.pid!, 0));
});

test("reconcileJob marks a dead-pid job completed if a terminal event was written", () => {
  const jobId = generateJobId();
  const job: Job = {
    jobId,
    status: "running",
    pid: 999999,
    pidStartedAt: new Date().toISOString(),
    workingDirectory: workDir,
    prompt: "x",
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
  };
  createJob(job);
  appendFileSync(
    eventsPath(jobId),
    '{"type":"step_finish","sessionID":"ses_x","part":{"type":"step-finish","reason":"stop","tokens":{"total":1,"input":1,"output":0,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0.001}}\n'
  );

  const reconciled = reconcileJob(job);
  assert.equal(reconciled.status, "completed");
  assert.equal(reconciled.tokens?.total, 1);
});

test("cancelJob reconciles before cancelling and does not destroy a completed orphaned job's result", () => {
  // Regression for the bug where cancelJob checked job.status directly
  // (without reconciling first). A job orphaned by a server restart can have
  // a dead pid on disk but a real terminal event in events.ndjson, meaning
  // the underlying process actually finished successfully. Calling
  // cancelJob on it must reconcile first and report the true "completed"
  // result, not clobber it with "cancelled".
  const jobId = generateJobId();
  const job: Job = {
    jobId,
    status: "running",
    pid: 999999, // dead pid, simulating a server restart
    pidStartedAt: new Date().toISOString(),
    workingDirectory: workDir,
    prompt: "x",
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
  };
  createJob(job);
  appendFileSync(
    eventsPath(jobId),
    '{"type":"step_finish","sessionID":"ses_x","part":{"type":"step-finish","reason":"stop","tokens":{"total":1,"input":1,"output":0,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0.001}}\n'
  );

  const result = cancelJob(jobId);
  assert.equal(result.status, "completed");
  assert.equal(result.tokens?.total, 1);
});

test("reconcileJob marks a dead-pid job failed if no terminal event was written", () => {
  const jobId = generateJobId();
  const job: Job = {
    jobId,
    status: "running",
    pid: 999999,
    pidStartedAt: new Date().toISOString(),
    workingDirectory: workDir,
    prompt: "x",
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
  };
  createJob(job);

  const reconciled = reconcileJob(job);
  assert.equal(reconciled.status, "failed");
});

test("isPidLikelyOurs accepts a process start time close to the recorded one", () => {
  // `ps -o lstart=` emits local time with no timezone marker, so `isPidLikelyOurs`
  // parses it as local time via `new Date(...)`. Derive `recorded` from the same
  // parse (offset by 2s) instead of hardcoding a UTC literal, so this assertion
  // holds regardless of the machine's timezone.
  const psOutput = "Mon Jul 27 10:00:02 2026"; // real `ps -o lstart=` format, local time
  const recorded = new Date(new Date(psOutput).getTime() - 2000).toISOString();
  assert.equal(isPidLikelyOurs(recorded, psOutput), true);
});

test("isPidLikelyOurs rejects a process start time far from the recorded one", () => {
  const recorded = "2026-07-27T10:00:00.000Z";
  const psOutput = "Mon Jan  1 00:00:00 2024";
  assert.equal(isPidLikelyOurs(recorded, psOutput), false);
});

test("isPidLikelyOurs is lenient when ps output is empty or unparseable", () => {
  const recorded = "2026-07-27T10:00:00.000Z";
  assert.equal(isPidLikelyOurs(recorded, ""), true);
  assert.equal(isPidLikelyOurs(recorded, "garbage"), true);
});
