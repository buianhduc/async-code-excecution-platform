import { ExecutionStatus } from '../../common/enums/execution-status.enum';
import { ExecutionRecord } from '../../common/types/domain.types';

export interface FinalizeExecutionInput {
  status:
    | ExecutionStatus.COMPLETED
    | ExecutionStatus.FAILED
    | ExecutionStatus.TIMEOUT;
  stdout?: string;
  stderr?: string;
  executionTimeMs: number;
  errorType?: string;
  errorMessage?: string;
  metadataJson?: Record<string, unknown>;
}

export interface ExecutionRepository {
  createQueued(sessionId: string): Promise<ExecutionRecord>;
  findById(executionId: string): Promise<ExecutionRecord | null>;
  markRunning(
    executionId: string,
    metadataJson?: Record<string, unknown>,
  ): Promise<ExecutionRecord | null>;
  incrementAttempt(executionId: string): Promise<void>;
  finalize(
    executionId: string,
    input: FinalizeExecutionInput,
  ): Promise<ExecutionRecord | null>;
  countQueuedSince(sessionId: string, since: Date): Promise<number>;
}
