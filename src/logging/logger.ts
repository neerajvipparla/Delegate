import { appendFileSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { getDelegateHome } from "../jobs/registry.js";
import { startViewer } from "./viewer.js";
import type { AppConfig } from "../config.js";

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  session_id?: string;
  job_id?: string;
  backend?: string;
  tool?: string;
  working_directory?: string;
  prompt?: string;
  response?: string;
  status?: string;
  exit_code?: number | null;
  duration_ms?: number | null;
  cost?: number | null;
  error?: string;
  [key: string]: unknown;
}

// `prompt` and `response` are logged in full (the whole point is to see what
// was asked and what the agent answered). Only `error` is capped — errors can
// be arbitrarily large and are never the thing you're reading for.
const FIELD_TRUNCATE_LIMIT = 500;
const TRUNCATED_FIELDS = new Set(["error"]);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let enabled = false;
let filePath: string | null = null;
let viewer: Server | null = null;
let truncateTimer: ReturnType<typeof setInterval> | null = null;

export function logsDir(): string {
  return join(getDelegateHome(), "logs");
}

export function logFilePath(): string {
  return join(logsDir(), "server.log");
}

export function isLoggingEnabled(): boolean {
  return enabled;
}

export function initLogger(config: AppConfig): void {
  if (viewer) {
    try { viewer.close(); } catch {}
    viewer = null;
  }
  if (truncateTimer) {
    clearInterval(truncateTimer);
    truncateTimer = null;
  }
  enabled = false;
  filePath = null;
  viewer = null;
  if (!config.logging.enabled) return;

  try {
    mkdirSync(logsDir(), { recursive: true });
    filePath = logFilePath();
    enabled = true;

    // Keep the file compact: clear it on startup if it already holds more
    // than a day of logs, and once a day while running. Lightweight — no
    // rotation/rename, just empty the file. The viewer tolerates truncation
    // (a client offset past EOF resets to 0).
    truncateIfStale();
    truncateTimer = setInterval(() => {
      try {
        if (filePath) writeFileSync(filePath, "");
      } catch {}
    }, ONE_DAY_MS);
    truncateTimer.unref();

    log("info", "server_start", "logging enabled", {
      port: config.logging.port,
      log_file: filePath,
    });
    // stderr is safe (not the MCP channel); this is how the user finds the
    // file and the viewer URL, since they cannot see stdout.
    process.stderr.write(
      `[claude-delegate] logging enabled -> ${filePath} ; viewer http://127.0.0.1:${config.logging.port}\n`
    );

    viewer = startViewer(config.logging.port, filePath, (err) => {
      log("warn", "error", "log viewer could not start", { error: String(err) });
      process.stderr.write(
        `[claude-delegate] log viewer could not start on port ${config.logging.port}: ${err}\n`
      );
    });
  } catch (err) {
    enabled = false;
    filePath = null;
    process.stderr.write(`[claude-delegate] logging init failed, continuing without logs: ${err}\n`);
  }
}

export function log(level: LogLevel, event: string, msg: string, fields: LogFields = {}): void {
  if (!enabled || !filePath) return;
  try {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      pid: process.pid,
      event,
      msg,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      entry[k] = typeof v === "string" && TRUNCATED_FIELDS.has(k) ? truncate(v) : v;
    }
    appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch {
    // A logging failure must never propagate into a tool call.
  }
}

function truncate(s: string): string {
  return s.length > FIELD_TRUNCATE_LIMIT ? s.slice(0, FIELD_TRUNCATE_LIMIT) + "…" : s;
}

// Empty the log file if its last write was more than a day ago, so a server
// starting up doesn't inherit a stale, unbounded log.
function truncateIfStale(): void {
  if (!filePath) return;
  try {
    if (existsSync(filePath) && Date.now() - statSync(filePath).mtimeMs > ONE_DAY_MS) {
      writeFileSync(filePath, "");
    }
  } catch {
    // truncation is best-effort; never let it break startup
  }
}

// Closes the viewer and resets logger state. Used by tests; also safe to call
// on shutdown.
export function shutdownLogger(): void {
  if (viewer) {
    viewer.close();
    viewer = null;
  }
  if (truncateTimer) {
    clearInterval(truncateTimer);
    truncateTimer = null;
  }
  enabled = false;
  filePath = null;
}
