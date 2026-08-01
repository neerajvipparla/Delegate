import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { delegateHandler } from "../src/tools/delegate.js";
import { checkStatusHandler } from "../src/tools/checkStatus.js";
import { getResultHandler } from "../src/tools/getResult.js";
import { listJobsHandler } from "../src/tools/listJobs.js";
import { cancelJobHandler } from "../src/tools/cancelJob.js";
import { createJob, generateJobId, eventsPath } from "../src/jobs/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_OPENCODE = join(__dirname, "fixtures", "fake-opencode.mjs");

let delegateHome: string;
let workDir: string;

beforeEach(() => {
  delegateHome = mkdtempSync(join(tmpdir(), "claude-delegate-home-"));
  workDir = mkdtempSync(join(tmpdir(), "claude-delegate-work-"));
  process.env.CLAUDE_DELEGATE_HOME = delegateHome;
  process.env.OPENCODE_BIN = FAKE_OPENCODE;
});

afterEach(() => {
  rmSync(delegateHome, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

function parseFirst(result: { content: { type: string; text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

test("delegate rejects a missing working_directory", async () => {
  const result = await delegateHandler({ prompt: "hi", working_directory: "/no/such/dir" });
  assert.equal(result.isError, true);
});

test("delegate -> check_status -> get_result happy path", async () => {
  const delegated = parseFirst(await delegateHandler({ prompt: "hello there", working_directory: workDir }));
  // delegate() waits briefly for session_id to appear before returning, so
  // a fast-finishing job (like this fake fixture's ~100ms "success" mode)
  // can legitimately already be "completed" by the time it returns --
  // session_id must be present either way.
  assert.ok(["running", "completed"].includes(delegated.status));
  assert.ok(
    delegated.session_id?.startsWith("ses_fake_"),
    "delegate() should already know the session_id by the time it returns"
  );

  let status = delegated;
  const start = Date.now();
  while (status.status === "running") {
    if (Date.now() - start > 3000) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 50));
    status = parseFirst(await checkStatusHandler({ job_id: delegated.job_id }));
  }

  assert.equal(status.status, "completed");
  assert.ok(status.session_id?.startsWith("ses_fake_"));

  const result = parseFirst(await getResultHandler({ job_id: delegated.job_id }));
  assert.equal(result.status, "completed");
  assert.match(result.output, /echo: hello there/);
  assert.equal(result.tokens.total, 10);
  assert.equal(result.output_truncated, false);
});

test("get_result reflects a failed run", async () => {
  const delegated = parseFirst(await delegateHandler({ prompt: "MODE=fail||boom", working_directory: workDir }));

  let result = parseFirst(await getResultHandler({ job_id: delegated.job_id }));
  const start = Date.now();
  while (result.status === "running") {
    if (Date.now() - start > 3000) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 50));
    result = parseFirst(await getResultHandler({ job_id: delegated.job_id }));
  }

  assert.equal(result.status, "failed");
  assert.match(result.error, /simulated failure/);
});

test("delegate rejects continuing a session from a different working_directory", async () => {
  const first = parseFirst(await delegateHandler({ prompt: "remember X", working_directory: workDir }));
  let status = first;
  const start = Date.now();
  while (status.status === "running") {
    if (Date.now() - start > 3000) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 50));
    status = parseFirst(await checkStatusHandler({ job_id: first.job_id }));
  }

  const otherDir = mkdtempSync(join(tmpdir(), "claude-delegate-other-"));
  try {
    const result = await delegateHandler({
      prompt: "continue",
      working_directory: otherDir,
      session_id: status.session_id,
    });
    assert.equal(result.isError, true);
  } finally {
    rmSync(otherDir, { recursive: true, force: true });
  }
});

test("delegate accepts a session continuation whose working_directory only differs by a trailing slash", async () => {
  const first = parseFirst(await delegateHandler({ prompt: "remember X", working_directory: workDir }));
  let status = first;
  const start = Date.now();
  while (status.status === "running") {
    if (Date.now() - start > 3000) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 50));
    status = parseFirst(await checkStatusHandler({ job_id: first.job_id }));
  }

  const result = await delegateHandler({
    prompt: "continue",
    working_directory: workDir + "/",
    session_id: status.session_id,
  });
  assert.notEqual(result.isError, true);
});

test("delegate rejects an unknown session id", async () => {
  const result = await delegateHandler({
    prompt: "continue",
    working_directory: workDir,
    session_id: "ses_does_not_exist",
  });
  assert.equal(result.isError, true);
});

test("list_jobs and cancel_job", async () => {
  const delegated = parseFirst(
    await delegateHandler({ prompt: "MODE=hang||run forever", working_directory: workDir })
  );

  const listed = parseFirst(await listJobsHandler({}));
  assert.ok(listed.jobs.some((j: { job_id: string }) => j.job_id === delegated.job_id));

  const cancelled = parseFirst(await cancelJobHandler({ job_id: delegated.job_id }));
  assert.equal(cancelled.status, "cancelled");
});

test("cancel_job on an unknown job id returns an error, not a throw", async () => {
  const result = await cancelJobHandler({ job_id: "nope" });
  assert.equal(result.isError, true);
});

test("list_jobs reconciles a job orphaned by a simulated server restart", async () => {
  const jobId = generateJobId();
  createJob({
    jobId,
    backend: "opencode",
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
  });
  // Simulate the process having finished successfully after the MCP server
  // that spawned it restarted and lost its in-memory child handle.
  appendFileSync(
    eventsPath(jobId),
    '{"type":"step_finish","sessionID":"ses_x","part":{"type":"step-finish","reason":"stop","tokens":{"total":1,"input":1,"output":0,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0.001}}\n'
  );

  const listed = parseFirst(await listJobsHandler({}));
  const found = listed.jobs.find((j: { job_id: string }) => j.job_id === jobId);
  assert.equal(found?.status, "completed");
});
