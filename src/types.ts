export type JobStatus = "running" | "completed" | "failed" | "cancelled";

export type BackendKind = "opencode" | "cursor";

export interface TokenUsage {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cache: { write: number; read: number };
}

export interface DelegateRequest {
  prompt: string;
  workingDirectory: string;
  backend: BackendKind;
  title?: string;
  sessionId?: string;
  fork?: boolean;
  model?: string;
  agent?: string;
  mode?: "plan" | "ask";
}

export interface Job {
  jobId: string;
  backend: BackendKind;
  status: JobStatus;
  pid: number | null;
  pidStartedAt: string | null;
  workingDirectory: string;
  prompt: string;
  title: string | null;
  sessionId: string | null;
  model: string | null;
  agent: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  tokens: TokenUsage | null;
  cost: number | null;
}
