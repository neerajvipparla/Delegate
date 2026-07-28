import type { TokenUsage } from "../types.js";

export interface ParsedEvents {
  output: string;
  summary: string;
  sessionId: string | null;
  tokens: TokenUsage | null;
  cost: number | null;
  hasTerminalEvent: boolean;
}

const SUMMARY_MAX_LENGTH = 200;

export function parseEvents(ndjsonText: string): ParsedEvents {
  let sessionId: string | null = null;
  let tokens: TokenUsage | null = null;
  let cost: number | null = null;
  let hasTerminalEvent = false;
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
      hasTerminalEvent = true;
      if (event.part?.tokens) {
        tokens = event.part.tokens;
      }
      if (typeof event.part?.cost === "number") {
        cost = event.part.cost;
      }
    }
  }

  const output = textParts.join("");
  const summary = output.length > SUMMARY_MAX_LENGTH ? output.slice(0, SUMMARY_MAX_LENGTH) + "…" : output;

  return { output, summary, sessionId, tokens, cost, hasTerminalEvent };
}
