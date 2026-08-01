import type { BackendModule } from "../types.js";
import { buildCursorArgs } from "./cli.js";
import { parseCursorEvents } from "./events.js";

export const cursorBackend: BackendModule = {
  kind: "cursor",
  resolveBin() {
    return process.env.CURSOR_AGENT_BIN ?? "agent";
  },
  buildArgs: buildCursorArgs,
  parseEvents: parseCursorEvents,
};
