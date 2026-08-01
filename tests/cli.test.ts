import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpencodeArgs } from "../src/backends/opencode/cli.js";

test("builds minimal args for a bare prompt", () => {
  const args = buildOpencodeArgs({
    prompt: "hello",
    workingDirectory: "/tmp/proj",
    backend: "opencode",
  });
  assert.deepEqual(args, ["run", "--format", "json", "--auto", "--dir", "/tmp/proj", "--", "hello"]);
});

test("puts -- immediately before the prompt even with a leading dash", () => {
  const args = buildOpencodeArgs({ prompt: "-1 plus 1", workingDirectory: "/tmp/proj", backend: "opencode" });
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), "-1 plus 1");
});

test("adds -s for session continuation", () => {
  const args = buildOpencodeArgs({
    prompt: "hi",
    workingDirectory: "/tmp/proj",
    backend: "opencode",
    sessionId: "ses_abc",
  });
  assert.ok(args.includes("-s"));
  assert.equal(args[args.indexOf("-s") + 1], "ses_abc");
  assert.ok(!args.includes("--fork"));
});

test("only adds --fork alongside a session id", () => {
  const args = buildOpencodeArgs({
    prompt: "hi",
    workingDirectory: "/tmp/proj",
    backend: "opencode",
    sessionId: "ses_abc",
    fork: true,
  });
  assert.ok(args.includes("--fork"));
});

test("ignores fork when no session id is present", () => {
  const args = buildOpencodeArgs({ prompt: "hi", workingDirectory: "/tmp/proj", backend: "opencode", fork: true });
  assert.ok(!args.includes("--fork"));
  assert.ok(!args.includes("-s"));
});

test("adds model and agent passthroughs", () => {
  const args = buildOpencodeArgs({
    prompt: "hi",
    workingDirectory: "/tmp/proj",
    backend: "opencode",
    model: "anthropic/claude",
    agent: "build",
  });
  assert.equal(args[args.indexOf("-m") + 1], "anthropic/claude");
  assert.equal(args[args.indexOf("--agent") + 1], "build");
});
