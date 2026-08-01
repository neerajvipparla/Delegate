import type { DelegateRequest } from "../../types.js";

export function buildCursorArgs(request: DelegateRequest): string[] {
  const args: string[] = [
    "-p",
    "--force",
    "--output-format",
    "stream-json",
    "--workspace",
    request.workingDirectory,
  ];

  if (request.sessionId) {
    args.push("--resume", request.sessionId);
  }
  if (request.model) {
    args.push("--model", request.model);
  }
  if (request.mode) {
    args.push("--mode", request.mode);
  }

  args.push(request.prompt);
  return args;
}
