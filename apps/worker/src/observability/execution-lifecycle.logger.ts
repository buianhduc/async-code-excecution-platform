import { Injectable, Logger } from '@nestjs/common';
import { ExecutionStatus } from '../common/enums/execution-status.enum';

@Injectable()
export class ExecutionLifecycleLogger {
  private readonly logger = new Logger(ExecutionLifecycleLogger.name);

  logTransition(
    executionId: string,
    fromStatus: ExecutionStatus | null,
    toStatus: ExecutionStatus,
    metadata?: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        executionId,
        fromStatus,
        toStatus,
        ...metadata,
      }),
    );
  }

  logQueueError(executionId: string, error: unknown): void {
    this.logger.error(
      JSON.stringify({
        executionId,
        message: 'Queue processing error',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
