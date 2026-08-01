import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLogger, isLoggingEnabled, log, logFilePath, logsDir, shutdownLogger } from "../src/logging/logger.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claude-delegate-logger-"));
  process.env.CLAUDE_DELEGATE_HOME = home;
});

afterEach(() => {
  shutdownLogger();
  rmSync(home, { recursive: true, force: true });
});

function readLines(): Record<string, unknown>[] {
  return readFileSync(logFilePath(), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test("disabled logger writes nothing and creates no logs directory", () => {
  initLogger({ logging: { enabled: false, port: 4599 } });
  log("info", "tool_call", "should not appear", { tool: "delegate" });
  assert.equal(existsSync(logsDir()), false);
});

test("enabled logger appends an NDJSON line with the required fields", () => {
  initLogger({ logging: { enabled: true, port: 0 } });
  log("info", "job_spawned", "spawned", { job_id: "abc", working_directory: "/repo" });
  const lines = readLines();
  // line 0 is the server_start line written by initLogger
  const spawn = lines.find((l) => l.event === "job_spawned")!;
  assert.equal(spawn.level, "info");
  assert.equal(spawn.msg, "spawned");
  assert.equal(spawn.job_id, "abc");
  assert.equal(spawn.working_directory, "/repo");
  assert.equal(typeof spawn.ts, "string");
  assert.equal(spawn.pid, process.pid);
});

test("initLogger writes a server_start line", () => {
  initLogger({ logging: { enabled: true, port: 0 } });
  const lines = readLines();
  assert.ok(lines.some((l) => l.event === "server_start"));
});

test("truncates prompt_preview and error to keep lines small", () => {
  initLogger({ logging: { enabled: true, port: 0 } });
  const big = "x".repeat(5000);
  log("info", "tool_call", "call", { tool: "delegate", prompt_preview: big });
  log("error", "error", "boom", { error: big });
  const lines = readLines();
  const call = lines.find((l) => l.event === "tool_call")!;
  const err = lines.find((l) => l.event === "error")!;
  assert.ok((call.prompt_preview as string).length <= 210);
  assert.ok((err.error as string).length <= 210);
});

test("omits undefined fields", () => {
  initLogger({ logging: { enabled: true, port: 0 } });
  log("info", "tool_call", "call", { tool: "delegate", session_id: undefined });
  const call = readLines().find((l) => l.event === "tool_call")!;
  assert.equal("session_id" in call, false);
});

test("isLoggingEnabled reflects the enabled flag", () => {
  initLogger({ logging: { enabled: false, port: 4599 } });
  assert.equal(isLoggingEnabled(), false);
  initLogger({ logging: { enabled: true, port: 0 } });
  assert.equal(isLoggingEnabled(), true);
});

test("log() after a disabled init is a silent no-op (does not throw)", () => {
  initLogger({ logging: { enabled: false, port: 4599 } });
  assert.doesNotThrow(() => log("info", "tool_call", "x"));
});

test("logging never writes to stdout (protects the MCP stream)", () => {
  const original = process.stdout.write.bind(process.stdout);
  let stdoutBytes = 0;
  (process.stdout as unknown as { write: (...a: unknown[]) => boolean }).write = (chunk: unknown, ...rest: unknown[]) => {
    stdoutBytes += typeof chunk === "string" ? chunk.length : (chunk as Buffer).length;
    return original(chunk as string, ...(rest as []));
  };
  try {
    initLogger({ logging: { enabled: true, port: 0 } });
    log("info", "tool_call", "one", { tool: "delegate" });
    log("warn", "error", "two", { error: "e" });
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  assert.equal(stdoutBytes, 0);
});
