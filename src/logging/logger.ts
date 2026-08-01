import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { getDelegateHome } from "../jobs/registry.js";
import { startViewer } from "./viewer.js";
import type { AppConfig } from "../config.js";

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  session_id?: string;
  job_id?: string;
  tool?: string;
  working_directory?: string;
  prompt_preview?: string;
  status?: string;
  exit_code?: number | null;
  duration_ms?: number | null;
  cost?: number | null;
  error?: string;
  [key: string]: unknown;
}

const FIELD_TRUNCATE_LIMIT = 200;
const TRUNCATED_FIELDS = new Set(["prompt_preview", "error"]);

let enabled = false;
let filePath: string | null = null;
let viewer: Server | null = null;

export function logsDir(): string {
  return join(getDelegateHome(), "logs");
}

export function logFilePath(): string {
  return join(logsDir(), "server.log");
}

export function initLogger(config: AppConfig): void {
  enabled = false;
  filePath = null;
  viewer = null;
  if (!config.logging.enabled) return;

  try {
    mkdirSync(logsDir(), { recursive: true });
    filePath = logFilePath();
    enabled = true;

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

// Closes the viewer and resets logger state. Used by tests; also safe to call
// on shutdown.
export function shutdownLogger(): void {
  if (viewer) {
    viewer.close();
    viewer = null;
  }
  enabled = false;
  filePath = null;
}
