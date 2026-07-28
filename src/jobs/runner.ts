import { spawn, execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync, existsSync } from "node:fs";
import { buildOpencodeArgs } from "../opencode/cli.js";
import { parseEvents } from "../opencode/events.js";
import * as registry from "./registry.js";
import type { DelegateRequest, Job } from "../types.js";

export function resolveOpencodeBin(): string {
  return process.env.OPENCODE_BIN ?? "opencode";
}

function cancelGraceMs(): number {
  return Number(process.env.CANCEL_GRACE_MS) || 5000;
}

export function spawnJob(request: DelegateRequest, jobId: string): Job {
  const startedAt = new Date().toISOString();
  const job: Job = {
    jobId,
    status: "running",
    pid: null,
    pidStartedAt: null,
    workingDirectory: request.workingDirectory,
    prompt: request.prompt,
    title: request.title ?? null,
    sessionId: request.sessionId ?? null,
    model: request.model ?? null,
    agent: request.agent ?? null,
    startedAt,
    finishedAt: null,
    exitCode: null,
    error: null,
    tokens: null,
    cost: null,
  };
  registry.createJob(job);

  const outFd = openSync(registry.eventsPath(jobId), "a");
  const errFd = openSync(registry.stderrPath(jobId), "a");

  const child = spawn(resolveOpencodeBin(), buildOpencodeArgs(request), {
    detached: true,
    stdio: ["ignore", outFd, errFd],
  });
  closeSync(outFd);
  closeSync(errFd);

  if (child.pid) {
    job.pid = child.pid;
    job.pidStartedAt = startedAt;
    registry.writeJob(job);
  }

  const pollHandle = setInterval(() => {
    const current = registry.readJob(jobId);
    if (!current || current.sessionId) {
      clearInterval(pollHandle);
      return;
    }
    const parsed = parseEvents(readFileSync(registry.eventsPath(jobId), "utf8"));
    if (parsed.sessionId) {
      registry.writeJob({ ...current, sessionId: parsed.sessionId });
      registry.indexSession(parsed.sessionId, jobId);
      clearInterval(pollHandle);
    }
  }, 250);
  pollHandle.unref();

  child.on("error", (err) => {
    clearInterval(pollHandle);
    const current = registry.readJob(jobId) ?? job;
    registry.writeJob({
      ...current,
      status: "failed",
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
  });

  child.on("exit", (code) => {
    clearInterval(pollHandle);
    finalizeJob(jobId, code);
  });

  child.unref();
  return job;
}

function finalizeJob(jobId: string, exitCode: number | null): void {
  const current = registry.readJob(jobId);
  if (!current) return;

  if (current.status !== "running") {
    // Already terminal (e.g. cancelled by cancelJob before the signaled
    // process's exit event fired) — don't let a signal-killed process's
    // exitCode (null, which reads as "failed" below) clobber that status.
    registry.writeJob({
      ...current,
      exitCode: current.exitCode ?? exitCode,
      finishedAt: current.finishedAt ?? new Date().toISOString(),
    });
    return;
  }

  const parsed = parseEvents(readFileSync(registry.eventsPath(jobId), "utf8"));
  const stderrTail = readStderrTail(jobId);

  registry.writeJob({
    ...current,
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    finishedAt: new Date().toISOString(),
    tokens: parsed.tokens ?? current.tokens,
    cost: parsed.cost ?? current.cost,
    sessionId: parsed.sessionId ?? current.sessionId,
    error: exitCode === 0 ? null : stderrTail || `opencode exited with code ${exitCode}`,
  });

  if (parsed.sessionId) {
    registry.indexSession(parsed.sessionId, jobId);
  }
}

function readStderrTail(jobId: string, maxLines = 50): string {
  if (!existsSync(registry.stderrPath(jobId))) return "";
  const lines = readFileSync(registry.stderrPath(jobId), "utf8").split("\n");
  return lines.slice(-maxLines).join("\n").trim();
}

export function reconcileJob(job: Job): Job {
  if (job.status !== "running") return job;
  if (job.pid && isPidAlive(job.pid)) return job;

  const parsed = parseEvents(readFileSync(registry.eventsPath(job.jobId), "utf8"));
  const stderrTail = readStderrTail(job.jobId);

  const updated: Job = parsed.hasTerminalEvent
    ? {
        ...job,
        status: "completed",
        finishedAt: job.finishedAt ?? new Date().toISOString(),
        tokens: parsed.tokens ?? job.tokens,
        cost: parsed.cost ?? job.cost,
        sessionId: parsed.sessionId ?? job.sessionId,
      }
    : {
        ...job,
        status: "failed",
        finishedAt: job.finishedAt ?? new Date().toISOString(),
        error: stderrTail || "process exited without a terminal event (unknown exit code)",
      };

  registry.writeJob(updated);
  return updated;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isPidLikelyOurs(
  recordedStartedAt: string,
  psLstartOutput: string,
  toleranceMs = 15000
): boolean {
  const trimmed = psLstartOutput.trim();
  if (!trimmed) return true;
  const actualStart = new Date(trimmed).getTime();
  if (Number.isNaN(actualStart)) return true;
  const recorded = new Date(recordedStartedAt).getTime();
  return Math.abs(actualStart - recorded) <= toleranceMs;
}

function pidLooksLikeOurs(job: Job): boolean {
  if (!job.pid || !job.pidStartedAt) return true;
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(job.pid)], { encoding: "utf8" });
    return isPidLikelyOurs(job.pidStartedAt, output);
  } catch {
    return true;
  }
}

export function cancelJob(jobId: string): Job {
  const job = registry.readJob(jobId);
  if (!job) {
    throw new Error(`job not found: ${jobId}`);
  }
  if (job.status !== "running" || !job.pid) {
    return job;
  }

  const updated: Job = { ...job, status: "cancelled", finishedAt: new Date().toISOString() };
  registry.writeJob(updated);

  if (!pidLooksLikeOurs(job)) {
    return updated;
  }

  try {
    process.kill(job.pid, "SIGTERM");
  } catch {
    // already gone
  }

  const pid = job.pid;
  setTimeout(() => {
    if (isPidAlive(pid) && pidLooksLikeOurs(job)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }, cancelGraceMs()).unref();

  return updated;
}
