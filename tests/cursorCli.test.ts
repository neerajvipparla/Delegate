import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCursorArgs } from "../src/backends/cursor/cli.js";

test("builds minimal cursor args for a bare prompt", () => {
  const args = buildCursorArgs({ prompt: "hello", workingDirectory: "/tmp/proj", backend: "cursor" });
  assert.deepEqual(args, [
    "-p",
    "--force",
    "--output-format",
    "stream-json",
    "--workspace",
    "/tmp/proj",
    "hello",
  ]);
});

test("adds --resume for session continuation", () => {
  const args = buildCursorArgs({
    prompt: "hi",
    workingDirectory: "/tmp/proj",
    backend: "cursor",
    sessionId: "cursor_sess_abc",
  });
  assert.ok(args.includes("--resume"));
  assert.equal(args[args.indexOf("--resume") + 1], "cursor_sess_abc");
});

test("adds model and mode passthroughs", () => {
  const args = buildCursorArgs({
    prompt: "hi",
    workingDirectory: "/tmp/proj",
    backend: "cursor",
    model: "composer-2.5",
    mode: "plan",
  });
  assert.equal(args[args.indexOf("--model") + 1], "composer-2.5");
  assert.equal(args[args.indexOf("--mode") + 1], "plan");
});
