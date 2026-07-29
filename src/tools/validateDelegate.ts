import { existsSync, statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveOpencodeBin } from "../jobs/runner.js";
import { getJobForSession } from "../jobs/registry.js";

export type ValidationResult = { ok: true; workingDirectory: string } | { ok: false; error: string };

export function validateDelegateRequest(input: {
  working_directory: string;
  session_id?: string;
}): ValidationResult {
  if (!existsSync(input.working_directory) || !statSync(input.working_directory).isDirectory()) {
    return {
      ok: false,
      error: `working_directory does not exist or is not a directory: ${input.working_directory}`,
    };
  }

  const workingDirectory = realpathSync(resolve(input.working_directory));

  if (!binaryResolvable(resolveOpencodeBin())) {
    return {
      ok: false,
      error: `opencode binary not found: ${resolveOpencodeBin()} (set OPENCODE_BIN or install opencode on PATH)`,
    };
  }

  if (input.session_id) {
    const priorJob = getJobForSession(input.session_id);
    if (!priorJob) {
      return { ok: false, error: `unknown session_id: ${input.session_id}` };
    }
    if (priorJob.workingDirectory !== workingDirectory) {
      return {
        ok: false,
        error:
          `session_id ${input.session_id} was created in ${priorJob.workingDirectory}, not ${workingDirectory}. ` +
          "Continuing an opencode session from a different working_directory hangs indefinitely, so this is rejected up front.",
      };
    }
  }

  return { ok: true, workingDirectory };
}

function binaryResolvable(bin: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
