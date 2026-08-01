import { existsSync, statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveBin } from "../backends/index.js";
import { normalizeBackend } from "../backends/index.js";
import { getJobForSession } from "../jobs/registry.js";
import type { BackendKind } from "../types.js";

export type ValidationResult = { ok: true; workingDirectory: string; backend: BackendKind } | { ok: false; error: string };

export function validateDelegateRequest(input: {
  working_directory: string;
  session_id?: string;
  backend?: BackendKind;
  fork?: boolean;
  agent?: string;
  mode?: "plan" | "ask";
}): ValidationResult {
  const backend = normalizeBackend(input.backend);

  if (!existsSync(input.working_directory) || !statSync(input.working_directory).isDirectory()) {
    return {
      ok: false,
      error: `working_directory does not exist or is not a directory: ${input.working_directory}`,
    };
  }

  const workingDirectory = realpathSync(resolve(input.working_directory));

  if (!binaryResolvable(resolveBin(backend))) {
    const envHint = backend === "cursor" ? "CURSOR_AGENT_BIN" : "OPENCODE_BIN";
    const name = backend === "cursor" ? "cursor agent" : "opencode";
    return {
      ok: false,
      error: `${name} binary not found: ${resolveBin(backend)} (set ${envHint} or install ${name} on PATH)`,
    };
  }

  if (backend === "cursor") {
    if (input.fork) {
      return { ok: false, error: "fork is only supported with backend opencode" };
    }
    if (input.agent) {
      return { ok: false, error: "agent is only supported with backend opencode" };
    }
  } else if (input.mode) {
    return { ok: false, error: "mode is only supported with backend cursor" };
  }

  if (input.session_id) {
    const priorJob = getJobForSession(input.session_id);
    if (!priorJob) {
      return { ok: false, error: `unknown session_id: ${input.session_id}` };
    }
    if (priorJob.backend !== backend) {
      return {
        ok: false,
        error:
          `session_id ${input.session_id} was created with backend ${priorJob.backend}, not ${backend}. ` +
          "Resume with the same backend that started the session.",
      };
    }
    if (priorJob.workingDirectory !== workingDirectory) {
      return {
        ok: false,
        error:
          `session_id ${input.session_id} was created in ${priorJob.workingDirectory}, not ${workingDirectory}. ` +
          "Continuing a session from a different working_directory hangs indefinitely, so this is rejected up front.",
      };
    }
  }

  return { ok: true, workingDirectory, backend };
}

function binaryResolvable(bin: string): boolean {
  if (bin.includes("/") || (process.platform === "win32" && bin.includes("\\"))) {
    return existsSync(bin);
  }
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
