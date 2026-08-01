import type { ParsedEvents } from "../types.js";

const SUMMARY_MAX_LENGTH = 200;

export function parseOpencodeEvents(ndjsonText: string): ParsedEvents {
  let sessionId: string | null = null;
  let tokens: ParsedEvents["tokens"] = null;
  let cost: number | null = null;
  let hasTerminalEvent = false;
  let error: string | null = null;
  const textParts: string[] = [];

  for (const line of ndjsonText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!sessionId && typeof event.sessionID === "string") {
      sessionId = event.sessionID;
    }

    if (event.type === "text" && typeof event.part?.text === "string") {
      textParts.push(event.part.text);
    }

    if (event.type === "step_finish") {
      if (event.part?.tokens) {
        tokens = event.part.tokens;
      }
      if (typeof event.part?.cost === "number") {
        cost = event.part.cost;
      }
      if (event.part?.reason === "stop") {
        hasTerminalEvent = true;
      }
    }

    if (event.type === "error" && event.error) {
      error = typeof event.error === "string" ? event.error : JSON.stringify(event.error);
    }
  }

  const output = textParts.join("");
  const summary = output.length > SUMMARY_MAX_LENGTH ? output.slice(0, SUMMARY_MAX_LENGTH) + "…" : output;
  // Final answer = the last text block the model emitted (the closing step),
  // not the earlier "let me check X" narration.
  const finalText = textParts.length ? textParts[textParts.length - 1] : "";

  return { output, summary, finalText, sessionId, tokens, cost, hasTerminalEvent, error, durationMs: null };
}
