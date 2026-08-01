import type { BackendKind, BackendModule, ParsedEvents } from "./types.js";
import { cursorBackend } from "./cursor/index.js";
import { opencodeBackend } from "./opencode/index.js";
import type { DelegateRequest } from "../types.js";

export type { BackendKind, ParsedEvents } from "./types.js";
export { defaultBackend, normalizeBackend } from "./types.js";

const backends: Record<BackendKind, BackendModule> = {
  opencode: opencodeBackend,
  cursor: cursorBackend,
};

export function getBackend(kind: BackendKind): BackendModule {
  return backends[kind];
}

export function resolveBin(kind: BackendKind): string {
  return getBackend(kind).resolveBin();
}

export function buildArgs(request: DelegateRequest, kind: BackendKind): string[] {
  return getBackend(kind).buildArgs(request);
}

export function parseEvents(ndjsonText: string, kind: BackendKind): ParsedEvents {
  return getBackend(kind).parseEvents(ndjsonText);
}
