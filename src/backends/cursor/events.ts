import type { ParsedEvents } from "../types.js";

const SUMMARY_MAX_LENGTH = 200;

export function parseCursorEvents(ndjsonText: string): ParsedEvents {
  let sessionId: string | null = null;
  let hasTerminalEvent = false;
  let error: string | null = null;
  let durationMs: number | null = null;
  const assistantParts: string[] = [];
  let terminalResult: string | null = null;

  for (const line of ndjsonText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!sessionId && typeof event.session_id === "string") {
      sessionId = event.session_id;
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block?.type === "text" && typeof block.text === "string") {
          assistantParts.push(block.text);
        }
      }
    }

    if (event.type === "result") {
      if (typeof event.duration_ms === "number") {
        durationMs = event.duration_ms;
      }
      if (event.subtype === "success" && event.is_error === false) {
        hasTerminalEvent = true;
        if (typeof event.result === "string") {
          terminalResult = event.result;
        }
      } else if (event.is_error) {
        error = typeof event.result === "string" ? event.result : "cursor agent run failed";
      }
    }
  }

  const output = terminalResult ?? assistantParts.join("");
  const summary = output.length > SUMMARY_MAX_LENGTH ? output.slice(0, SUMMARY_MAX_LENGTH) + "…" : output;
  // Cursor's terminal `result` event IS the final answer; fall back to the
  // last assistant block if the stream ended without one.
  const finalText = terminalResult ?? (assistantParts.length ? assistantParts[assistantParts.length - 1] : "");

  return {
    output,
    summary,
    finalText,
    sessionId,
    tokens: null,
    cost: null,
    hasTerminalEvent,
    error,
    durationMs,
  };
}
