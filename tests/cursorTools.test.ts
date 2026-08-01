import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { delegateHandler } from "../src/tools/delegate.js";
import { delegateSyncHandler } from "../src/tools/delegateSync.js";
import { checkStatusHandler } from "../src/tools/checkStatus.js";
import { getResultHandler } from "../src/tools/getResult.js";
import { validateDelegateRequest } from "../src/tools/validateDelegate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_CURSOR = join(__dirname, "fixtures", "fake-cursor-agent.mjs");

let delegateHome: string;
let workDir: string;

beforeEach(() => {
  delegateHome = mkdtempSync(join(tmpdir(), "claude-delegate-home-"));
  workDir = mkdtempSync(join(tmpdir(), "claude-delegate-work-"));
  process.env.CLAUDE_DELEGATE_HOME = delegateHome;
  process.env.CURSOR_AGENT_BIN = FAKE_CURSOR;
});

afterEach(() => {
  rmSync(delegateHome, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

function parseFirst(result: { content: { type: string; text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

test("cursor delegate -> check_status -> get_result happy path", async () => {
  const delegated = parseFirst(
    await delegateHandler({ prompt: "hello cursor", working_directory: workDir, backend: "cursor" })
  );
  assert.equal(delegated.backend, "cursor");
  assert.ok(["running", "completed"].includes(delegated.status));
  assert.ok(delegated.session_id?.startsWith("cursor_fake_"));

  let status = delegated;
  const start = Date.now();
  while (status.status === "running") {
    if (Date.now() - start > 3000) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 50));
    status = parseFirst(await checkStatusHandler({ job_id: delegated.job_id }));
  }

  const result = parseFirst(await getResultHandler({ job_id: delegated.job_id }));
  assert.equal(result.status, "completed");
  assert.equal(result.backend, "cursor");
  assert.match(result.output, /echo: hello cursor/);
  assert.equal(result.tokens, null);
  assert.equal(result.cost, null);
});

test("cursor delegate_sync returns the final result", async () => {
  const result = parseFirst(
    await delegateSyncHandler({ prompt: "sync cursor", working_directory: workDir, backend: "cursor" })
  );
  assert.equal(result.status, "completed");
  assert.equal(result.backend, "cursor");
  assert.match(result.output, /echo: sync cursor/);
});

test("rejects opencode-only fork with cursor backend", () => {
  const result = validateDelegateRequest({
    working_directory: workDir,
    backend: "cursor",
    fork: true,
  });
  assert.equal(result.ok, false);
});

test("rejects cursor-only mode with opencode backend", () => {
  const result = validateDelegateRequest({
    working_directory: workDir,
    backend: "opencode",
    mode: "plan",
  });
  assert.equal(result.ok, false);
});

test("rejects resuming an opencode session with cursor backend", async () => {
  process.env.OPENCODE_BIN = join(__dirname, "fixtures", "fake-opencode.mjs");
  const opencode = parseFirst(
    await delegateHandler({ prompt: "remember", working_directory: workDir, backend: "opencode" })
  );

  let status = opencode;
  const start = Date.now();
  while (status.status === "running") {
    if (Date.now() - start > 3000) throw new Error("opencode job did not finish");
    await new Promise((r) => setTimeout(r, 50));
    status = parseFirst(await checkStatusHandler({ job_id: opencode.job_id }));
  }

  const result = await delegateHandler({
    prompt: "continue",
    working_directory: workDir,
    backend: "cursor",
    session_id: status.session_id,
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /backend opencode, not cursor/);
});
