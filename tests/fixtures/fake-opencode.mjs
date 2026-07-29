#!/usr/bin/env node
// Test-only stand-in for the real opencode CLI. The mode is embedded in the
// prompt itself (as a "MODE=<mode>||<rest of prompt>" prefix) rather than
// read from an env var, so concurrently-running tests in the same process
// can never race on a shared mutable FAKE_OPENCODE_MODE global.
const rawPrompt = process.argv.at(-1) ?? "";
const match = rawPrompt.match(/^MODE=([\w-]+)\|\|([\s\S]*)$/);
const mode = match ? match[1] : "success";
const prompt = match ? match[2] : rawPrompt;
const sessionId = "ses_fake_" + Math.random().toString(36).slice(2, 10);

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

if (mode === "hang-ignore-sigterm") {
  process.on("SIGTERM", () => {});
}

async function main() {
  emit({ type: "step_start", sessionID: sessionId, part: { type: "step-start" } });

  if (mode === "hang" || mode === "hang-ignore-sigterm") {
    // A bare `await new Promise(() => {})` registers no libuv handle, so the
    // event loop drains and the process exits 0 on its own -- it never
    // actually hangs. Hold an active timer handle so the process only ever
    // exits via an external signal (SIGTERM/SIGKILL), as the tests intend.
    setInterval(() => {}, 1 << 30);
    await new Promise(() => {});
    return;
  }

  if (mode === "slow") {
    // Stays alive and keeps producing output (5 heartbeats, 150ms apart,
    // ~750ms total) before finishing -- used to test delegate_sync's
    // max_wait_ms fallback (healthy but slow) distinctly from its stall
    // detection (alive but producing nothing).
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      emit({ type: "text", sessionID: sessionId, part: { type: "text", text: `heartbeat ${i}` } });
    }
    emit({ type: "text", sessionID: sessionId, part: { type: "text", text: `echo: ${prompt}` } });
    emit({
      type: "step_finish",
      sessionID: sessionId,
      part: {
        type: "step-finish",
        reason: "stop",
        tokens: { total: 10, input: 8, output: 2, reasoning: 0, cache: { write: 0, read: 0 } },
        cost: 0.0001,
      },
    });
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 100));

  if (mode === "fail") {
    process.stderr.write("simulated failure\n");
    process.exit(1);
  }

  emit({ type: "text", sessionID: sessionId, part: { type: "text", text: `echo: ${prompt}` } });
  emit({
    type: "step_finish",
    sessionID: sessionId,
    part: {
      type: "step-finish",
      reason: "stop",
      tokens: { total: 10, input: 8, output: 2, reasoning: 0, cache: { write: 0, read: 0 } },
      cost: 0.0001,
    },
  });
  process.exit(0);
}

main();
