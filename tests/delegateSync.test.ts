import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { delegateSyncHandler } from "../src/tools/delegateSync.js";

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

test("delegate_sync returns the final result when the job completes quickly", async () => {
  const result = parseFirst(await delegateSyncHandler({ prompt: "hello sync", working_directory: workDir }));
  assert.equal(result.status, "completed");
  assert.match(result.output, /echo: hello sync/);
  assert.equal(result.tokens.total, 10);
});

test("delegate_sync returns the failed result directly, no follow-up call needed", async () => {
  const result = parseFirst(
    await delegateSyncHandler({ prompt: "MODE=fail||boom", working_directory: workDir })
  );
  assert.equal(result.status, "failed");
  assert.match(result.error, /simulated failure/);
});

test("delegate_sync falls back to running+timed_out when max_wait_ms is hit but the job is healthy", async () => {
  const result = parseFirst(
    await delegateSyncHandler({
      prompt: "MODE=slow||hello",
      working_directory: workDir,
      max_wait_ms: 300,
      stall_timeout_ms: 5000,
    })
  );
  assert.equal(result.status, "running");
  assert.equal(result.timed_out, true);
  assert.ok(result.job_id);
});

test("delegate_sync cancels and reports stalled when opencode produces no further output", async () => {
  const result = parseFirst(
    await delegateSyncHandler({
      prompt: "MODE=hang||hello",
      working_directory: workDir,
      max_wait_ms: 10000,
      stall_timeout_ms: 500,
    })
  );
  assert.equal(result.status, "cancelled");
  assert.equal(result.stalled, true);
  assert.match(result.error, /no new output/);
});

test("delegate_sync rejects a missing working_directory the same way delegate does", async () => {
  const result = await delegateSyncHandler({ prompt: "hi", working_directory: "/no/such/dir" });
  assert.equal(result.isError, true);
});
