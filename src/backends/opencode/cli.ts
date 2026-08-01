import type { DelegateRequest } from "../../types.js";

export function buildOpencodeArgs(request: DelegateRequest): string[] {
  const args: string[] = ["run", "--format", "json", "--auto", "--dir", request.workingDirectory];

  if (request.sessionId) {
    args.push("-s", request.sessionId);
    if (request.fork) {
      args.push("--fork");
    }
  }
  if (request.model) {
    args.push("-m", request.model);
  }
  if (request.agent) {
    args.push("--agent", request.agent);
  }

  args.push("--", request.prompt);
  return args;
}
