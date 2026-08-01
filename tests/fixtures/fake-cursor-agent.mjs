#!/usr/bin/env node
// Test-only stand-in for the Cursor agent CLI. Mode is embedded in the prompt
// as "MODE=<mode>||<rest>" so concurrent tests never race on shared state.
const rawPrompt = process.argv.at(-1) ?? "";
const match = rawPrompt.match(/^MODE=([\w-]+)\|\|([\s\S]*)$/);
const mode = match ? match[1] : "success";
const prompt = match ? match[2] : rawPrompt;
const sessionId = "cursor_fake_" + Math.random().toString(36).slice(2, 10);

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

if (mode === "hang-ignore-sigterm") {
  process.on("SIGTERM", () => {});
}

async function main() {
  emit({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    cwd: process.cwd(),
    model: "fake-cursor",
  });

  if (mode === "hang" || mode === "hang-ignore-sigterm") {
    setInterval(() => {}, 1 << 30);
    await new Promise(() => {});
    return;
  }

  if (mode === "slow") {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      emit({
        type: "assistant",
        session_id: sessionId,
        message: { role: "assistant", content: [{ type: "text", text: `heartbeat ${i}` }] },
      });
    }
    const text = `echo: ${prompt}`;
    emit({
      type: "assistant",
      session_id: sessionId,
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
    emit({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 750,
      result: text,
      session_id: sessionId,
    });
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 100));

  if (mode === "fail") {
    process.stderr.write("simulated cursor failure\n");
    process.exit(1);
  }

  const text = `echo: ${prompt}`;
  emit({
    type: "assistant",
    session_id: sessionId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 100,
    result: text,
    session_id: sessionId,
  });
  process.exit(0);
}

main();
