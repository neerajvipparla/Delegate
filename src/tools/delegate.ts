import { z } from "zod";
import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { spawnJob, resolveOpencodeBin } from "../jobs/runner.js";
import { generateJobId, getJobForSession } from "../jobs/registry.js";

export const delegateInputShape = {
  prompt: z.string().min(1),
  working_directory: z.string().min(1),
  title: z.string().optional(),
  session_id: z.string().optional(),
  fork: z.boolean().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
};

const delegateInputSchema = z.object(delegateInputShape);
type DelegateInput = z.infer<typeof delegateInputSchema>;

export async function delegateHandler(
  input: DelegateInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  if (!existsSync(input.working_directory) || !statSync(input.working_directory).isDirectory()) {
    return errorResult(`working_directory does not exist or is not a directory: ${input.working_directory}`);
  }

  if (!binaryResolvable(resolveOpencodeBin())) {
    return errorResult(
      `opencode binary not found: ${resolveOpencodeBin()} (set OPENCODE_BIN or install opencode on PATH)`
    );
  }

  if (input.session_id) {
    const priorJob = getJobForSession(input.session_id);
    if (!priorJob) {
      return errorResult(`unknown session_id: ${input.session_id}`);
    }
    if (priorJob.workingDirectory !== input.working_directory) {
      return errorResult(
        `session_id ${input.session_id} was created in ${priorJob.workingDirectory}, not ${input.working_directory}. ` +
          "Continuing an opencode session from a different working_directory hangs indefinitely, so this is rejected up front."
      );
    }
  }

  const jobId = generateJobId();
  const job = spawnJob(
    {
      prompt: input.prompt,
      workingDirectory: input.working_directory,
      title: input.title,
      sessionId: input.session_id,
      fork: input.fork,
      model: input.model,
      agent: input.agent,
    },
    jobId
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ job_id: job.jobId, status: job.status, started_at: job.startedAt }),
      },
    ],
  };
}

function binaryResolvable(bin: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
