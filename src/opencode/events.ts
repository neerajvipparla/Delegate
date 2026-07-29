import type { TokenUsage } from "../types.js";

export interface ParsedEvents {
  output: string;
  summary: string;
  sessionId: string | null;
  tokens: TokenUsage | null;
  cost: number | null;
  /**
   * True once a `step_finish` event with `part.reason === "stop"` has been
   * seen — i.e. the run's FINAL step (the model decided to stop generating),
   * not merely any intermediate step in a multi-step agentic run.
   */
  hasTerminalEvent: boolean;
  error: string | null;
}

const SUMMARY_MAX_LENGTH = 200;

export function parseEvents(ndjsonText: string): ParsedEvents {
  let sessionId: string | null = null;
  let tokens: TokenUsage | null = null;
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

  return { output, summary, sessionId, tokens, cost, hasTerminalEvent, error };
}
