import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initLogger, logFilePath, shutdownLogger } from "../src/logging/logger.js";
import { withLogging } from "../src/logging/toolLogging.js";
import { delegateHandler } from "../src/tools/delegate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_OPENCODE = join(__dirname, "fixtures", "fake-opencode.mjs");

let home: string;
let workDir: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claude-delegate-logint-home-"));
  workDir = mkdtempSync(join(tmpdir(), "claude-delegate-logint-work-"));
  process.env.CLAUDE_DELEGATE_HOME = home;
  process.env.OPENCODE_BIN = FAKE_OPENCODE;
  initLogger({ logging: { enabled: true, port: 0 } });
});

afterEach(() => {
  shutdownLogger();
  rmSync(home, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

function lines(): Record<string, unknown>[] {
  return readFileSync(logFilePath(), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test("withLogging emits tool_call and tool_result lines around a handler", async () => {
  const wrapped = withLogging("delegate", delegateHandler);
  const res = await wrapped({ prompt: "hello there", working_directory: workDir });
  const delegated = JSON.parse(res.content[0].text);

  const call = lines().find((l) => l.event === "tool_call" && l.tool === "delegate");
  const result = lines().find((l) => l.event === "tool_result" && l.tool === "delegate");
  assert.ok(call, "expected a tool_call line");
  assert.equal(call!.working_directory, workDir);
  assert.ok(result, "expected a tool_result line");
  assert.equal(typeof result!.duration_ms, "number");
  assert.ok(delegated.job_id);
});

test("runner logs job_spawned and job_finalized for a delegated job", async () => {
  const res = await delegateHandler({ prompt: "hello", working_directory: workDir });
  const jobId = JSON.parse(res.content[0].text).job_id;

  // wait for the fake job to finish and finalize
  const start = Date.now();
  while (!lines().some((l) => l.event === "job_finalized" && l.job_id === jobId)) {
    if (Date.now() - start > 3000) throw new Error("no job_finalized line appeared");
    await new Promise((r) => setTimeout(r, 50));
  }

  const spawned = lines().find((l) => l.event === "job_spawned" && l.job_id === jobId);
  const finalized = lines().find((l) => l.event === "job_finalized" && l.job_id === jobId);
  assert.ok(spawned, "expected a job_spawned line");
  // job_spawned carries the resolved working directory (realpath of the input)
  assert.equal(spawned!.working_directory, realpathSync(workDir));
  assert.equal(finalized!.status, "completed");
});
