import type { DelegateRequest, TokenUsage } from "../types.js";

export type BackendKind = "opencode" | "cursor";

export interface ParsedEvents {
  output: string;
  summary: string;
  /**
   * The agent's final answer specifically — the last assistant text block
   * (OpenCode) or the terminal result (Cursor) — as opposed to `output`,
   * which is the whole transcript including intermediate "let me do X"
   * narration. Empty string if the run produced no text.
   */
  finalText: string;
  sessionId: string | null;
  tokens: TokenUsage | null;
  cost: number | null;
  hasTerminalEvent: boolean;
  error: string | null;
  durationMs: number | null;
}

export function defaultBackend(): BackendKind {
  return "opencode";
}

export function normalizeBackend(backend?: BackendKind): BackendKind {
  return backend ?? defaultBackend();
}

export interface BackendModule {
  kind: BackendKind;
  resolveBin(): string;
  buildArgs(request: DelegateRequest): string[];
  parseEvents(ndjsonText: string): ParsedEvents;
}
