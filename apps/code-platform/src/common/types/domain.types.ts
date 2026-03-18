export type SessionStatusValue = 'ACTIVE';
export type LanguageValue = 'PYTHON' | 'JAVASCRIPT';
export type ExecutionStatusValue =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT';

export interface CodeSessionRecord {
  id: string;
  language: LanguageValue;
  sourceCode: string;
  status: SessionStatusValue;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionRecord {
  id: string;
  sessionId: string;
  status: ExecutionStatusValue;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  stdout: string | null;
  stderr: string | null;
  executionTimeMs: number | null;
  attemptCount: number;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionEventRecord {
  id: string;
  executionId: string;
  fromStatus: ExecutionStatusValue | null;
  toStatus: ExecutionStatusValue;
  at: Date;
  metadataJson: Record<string, unknown> | null;
}
