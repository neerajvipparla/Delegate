import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

let dir: string;
const originalConfigEnv = process.env.CLAUDE_DELEGATE_CONFIG;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-delegate-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalConfigEnv === undefined) delete process.env.CLAUDE_DELEGATE_CONFIG;
  else process.env.CLAUDE_DELEGATE_CONFIG = originalConfigEnv;
});

test("loads a valid config file named by CLAUDE_DELEGATE_CONFIG", () => {
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ logging: { enabled: true, port: 7000 } }));
  process.env.CLAUDE_DELEGATE_CONFIG = p;
  assert.deepEqual(loadConfig(), { logging: { enabled: true, port: 7000 } });
});

test("returns defaults when the config file is missing", () => {
  process.env.CLAUDE_DELEGATE_CONFIG = join(dir, "does-not-exist.json");
  assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
});

test("returns defaults (does not throw) on malformed JSON", () => {
  const p = join(dir, "config.json");
  writeFileSync(p, "{ this is not json ]");
  process.env.CLAUDE_DELEGATE_CONFIG = p;
  assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
});

test("fills in per-field defaults for missing or wrong-typed fields", () => {
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ logging: { enabled: "yes", port: 8080 } }));
  process.env.CLAUDE_DELEGATE_CONFIG = p;
  // enabled is not a boolean -> falls back to default false; port is valid -> kept
  assert.deepEqual(loadConfig(), { logging: { enabled: false, port: 8080 } });
});

test("with no env override, resolves the committed repo-root config.json", () => {
  delete process.env.CLAUDE_DELEGATE_CONFIG;
  assert.deepEqual(loadConfig(), { logging: { enabled: false, port: 4599 } });
});
