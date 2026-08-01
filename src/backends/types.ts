import type { DelegateRequest, TokenUsage } from "../types.js";

export type BackendKind = "opencode" | "cursor";

export interface ParsedEvents {
  output: string;
  summary: string;
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
