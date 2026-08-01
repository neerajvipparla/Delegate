import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { delegateInputShape, delegateHandler } from "./tools/delegate.js";
import { delegateSyncInputShape, delegateSyncHandler } from "./tools/delegateSync.js";
import { checkStatusInputShape, checkStatusHandler } from "./tools/checkStatus.js";
import { getResultInputShape, getResultHandler } from "./tools/getResult.js";
import { listJobsInputShape, listJobsHandler } from "./tools/listJobs.js";
import { cancelJobInputShape, cancelJobHandler } from "./tools/cancelJob.js";
import { loadConfig } from "./config.js";
import { initLogger } from "./logging/logger.js";
import { withLogging } from "./logging/toolLogging.js";

const server = new McpServer({ name: "claude-delegate", version: "0.1.0" });

server.registerTool(
  "delegate",
  {
    description:
      "Delegate a coding or research task to OpenCode or Cursor as a background job. Set backend to 'cursor' or 'opencode' from the user's request; default opencode when unspecified.",
    inputSchema: delegateInputShape,
  },
  withLogging("delegate", delegateHandler)
);

server.registerTool(
  "delegate_sync",
  {
    description:
      "Like delegate(), but waits for the job to finish before returning (or falls back to a running job_id if max_wait_ms elapses, or cancels and reports stalled if no output for stall_timeout_ms). Set backend from the user's request; default opencode.",
    inputSchema: delegateSyncInputShape,
  },
  withLogging("delegate_sync", delegateSyncHandler)
);

server.registerTool(
  "check_status",
  { description: "Check the status of a previously started delegate() job.", inputSchema: checkStatusInputShape },
  withLogging("check_status", checkStatusHandler)
);

server.registerTool(
  "get_result",
  {
    description:
      "Get the structured result (summary, output, tokens, cost) of a delegate() job, even while still running.",
    inputSchema: getResultInputShape,
  },
  withLogging("get_result", getResultHandler)
);

server.registerTool(
  "list_jobs",
  { description: "List delegate() jobs, optionally filtered by status.", inputSchema: listJobsInputShape },
  withLogging("list_jobs", listJobsHandler)
);

server.registerTool(
  "cancel_job",
  { description: "Cancel a running delegate() job.", inputSchema: cancelJobInputShape },
  withLogging("cancel_job", cancelJobHandler)
);

async function main() {
  initLogger(loadConfig());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
