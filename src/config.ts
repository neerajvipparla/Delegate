import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface AppConfig {
  logging: { enabled: boolean; port: number };
}

export const DEFAULT_CONFIG: AppConfig = { logging: { enabled: false, port: 4599 } };

function defaultConfigPath(): string {
  // This module compiles to dist/config.js and runs from src/config.ts under
  // tsx; in both cases "../config.json" relative to the module resolves to the
  // repository-root config.json.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config.json");
}

export function loadConfig(): AppConfig {
  const path = process.env.CLAUDE_DELEGATE_CONFIG ?? defaultConfigPath();
  if (!existsSync(path)) return DEFAULT_CONFIG;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_CONFIG;
  }

  const logging = (raw as { logging?: unknown })?.logging as { enabled?: unknown; port?: unknown } | undefined;
  const enabled = typeof logging?.enabled === "boolean" ? logging.enabled : DEFAULT_CONFIG.logging.enabled;
  const port =
    typeof logging?.port === "number" &&
    Number.isInteger(logging.port) &&
    logging.port > 0 &&
    logging.port <= 65535
      ? logging.port
      : DEFAULT_CONFIG.logging.port;

  return { logging: { enabled, port } };
}
