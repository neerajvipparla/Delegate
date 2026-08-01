import type { BackendModule } from "../types.js";
import { buildOpencodeArgs } from "./cli.js";
import { parseOpencodeEvents } from "./events.js";

export const opencodeBackend: BackendModule = {
  kind: "opencode",
  resolveBin() {
    return process.env.OPENCODE_BIN ?? "opencode";
  },
  buildArgs: buildOpencodeArgs,
  parseEvents: parseOpencodeEvents,
};
