import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "dist", "server.js");

const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

const timeout = setTimeout(() => {
  console.error("FAIL: no response within 5s");
  child.kill();
  process.exit(1);
}, 5000);

let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex === -1) return;

  clearTimeout(timeout);
  const line = buffer.slice(0, newlineIndex);
  try {
    const response = JSON.parse(line);
    if (response.result?.serverInfo?.name === "claude-delegate") {
      console.log("PASS: server responded to initialize");
      child.kill();
      process.exit(0);
    } else {
      console.error("FAIL: unexpected response", response);
      child.kill();
      process.exit(1);
    }
  } catch (err) {
    console.error("FAIL: could not parse response", line, err);
    child.kill();
    process.exit(1);
  }
});

child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify-server", version: "0.0.0" },
    },
  }) + "\n"
);
