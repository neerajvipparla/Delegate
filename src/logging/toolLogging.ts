import { isLoggingEnabled, log } from "./logger.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function withLogging<A extends Record<string, unknown>>(
  toolName: string,
  handler: (args: A, extra?: { signal?: AbortSignal }) => Promise<ToolResult>
): (args: A, extra?: { signal?: AbortSignal }) => Promise<ToolResult> {
  return async (args: A, extra?: { signal?: AbortSignal }): Promise<ToolResult> => {
    if (!isLoggingEnabled()) return handler(args, extra);
    const start = Date.now();
    const a = args as Record<string, unknown>;
    log("info", "tool_call", `${toolName} called`, {
      tool: toolName,
      working_directory: typeof a.working_directory === "string" ? a.working_directory : undefined,
      prompt_preview: typeof a.prompt === "string" ? a.prompt : undefined,
      job_id: typeof a.job_id === "string" ? a.job_id : undefined,
      session_id: typeof a.session_id === "string" ? a.session_id : undefined,
    });

    let result;
    try {
      result = await handler(args, extra);
    } catch (e) {
      log("error", "tool_result", `${toolName} threw`, {
        tool: toolName,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - start,
      });
      throw e;
    }

    let status: string | undefined;
    let sessionId: string | undefined;
    try {
      const payload = JSON.parse(result.content?.[0]?.text ?? "{}");
      status = typeof payload.status === "string" ? payload.status : undefined;
      sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
    } catch {
      // non-JSON error message body; leave status/sessionId undefined
    }

    log(result.isError ? "warn" : "info", "tool_result", `${toolName} returned`, {
      tool: toolName,
      status: result.isError ? "error" : status,
      session_id: sessionId,
      duration_ms: Date.now() - start,
    });

    return result;
  };
}
