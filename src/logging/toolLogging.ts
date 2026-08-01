import { isLoggingEnabled, log } from "./logger.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

// Pure poll/read tools that clients call repeatedly while waiting on a job.
// Logging them floods the log with near-identical lines and buries the real
// story (delegate -> job_spawned -> job_finalized). The job-lifecycle events
// already capture every state change, so these are silent.
const SILENT_TOOLS = new Set(["check_status", "list_jobs"]);

export function withLogging<A extends Record<string, unknown>>(
  toolName: string,
  handler: (args: A, extra?: { signal?: AbortSignal }) => Promise<ToolResult>
): (args: A, extra?: { signal?: AbortSignal }) => Promise<ToolResult> {
  return async (args: A, extra?: { signal?: AbortSignal }): Promise<ToolResult> => {
    if (!isLoggingEnabled() || SILENT_TOOLS.has(toolName)) return handler(args, extra);
    const start = Date.now();
    const a = args as Record<string, unknown>;
    log("info", "tool_call", `${toolName} called`, {
      tool: toolName,
      backend: typeof a.backend === "string" ? a.backend : undefined,
      working_directory: typeof a.working_directory === "string" ? a.working_directory : undefined,
      prompt: typeof a.prompt === "string" ? a.prompt : undefined,
      job_id: typeof a.job_id === "string" ? a.job_id : undefined,
      session_id: typeof a.session_id === "string" ? a.session_id : undefined,
    });

    let result;
    try {
      result = await handler(args, extra);
    } catch (e) {
      log("error", "tool_result", `${toolName} threw`, {
        tool: toolName,
        backend: typeof a.backend === "string" ? a.backend : undefined,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - start,
      });
      throw e;
    }

    let status: string | undefined;
    let sessionId: string | undefined;
    let backend: string | undefined;
    try {
      const payload = JSON.parse(result.content?.[0]?.text ?? "{}");
      status = typeof payload.status === "string" ? payload.status : undefined;
      sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
      backend = typeof payload.backend === "string" ? payload.backend : undefined;
    } catch {
      // non-JSON error message body; leave status/sessionId/backend undefined
    }

    log(result.isError ? "warn" : "info", "tool_result", `${toolName} returned`, {
      tool: toolName,
      backend: backend ?? (typeof a.backend === "string" ? a.backend : undefined),
      status: result.isError ? "error" : status,
      session_id: sessionId,
      duration_ms: Date.now() - start,
    });

    return result;
  };
}
