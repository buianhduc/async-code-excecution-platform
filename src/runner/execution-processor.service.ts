import { Inject, Injectable } from '@nestjs/common';
import type { CodeSessionRepository } from '../database/repositories/code-session.repository';
import {
  type ExecutionRepository,
  type FinalizeExecutionInput,
} from '../database/repositories/execution.repository';
import {
  CODE_SESSION_REPOSITORY,
  EXECUTION_REPOSITORY,
} from '../database/repositories/repository.tokens';
import {
  ExecutionStatus,
  isTerminalExecutionStatus,
} from '../common/enums/execution-status.enum';
import { AppConfigService } from '../config/app-config.service';
import { CodeExecutorRegistry } from './executors/code-executor.registry';
import { ExecutionLifecycleLogger } from '../observability/execution-lifecycle.logger';
import { SupportedLanguage } from '../common/enums/language.enum';

@Injectable()
export class ExecutionProcessorService {
  constructor(
    @Inject(CODE_SESSION_REPOSITORY)
    private readonly codeSessionRepository: CodeSessionRepository,
    @Inject(EXECUTION_REPOSITORY)
    private readonly executionRepository: ExecutionRepository,
    private readonly config: AppConfigService,
    private readonly executorRegistry: CodeExecutorRegistry,
    private readonly lifecycleLogger: ExecutionLifecycleLogger,
  ) {}

  async processExecution(executionId: string): Promise<void> {
    let execution = await this.executionRepository.findById(executionId);
    if (
      !execution ||
      isTerminalExecutionStatus(execution.status as ExecutionStatus)
    ) {
      return;
    }

    if (execution.status === ExecutionStatus.QUEUED) {
      const running = await this.executionRepository.markRunning(executionId, {
        queuedAt: execution.queuedAt.toISOString(),
      });

      if (!running) {
        execution = await this.executionRepository.findById(executionId);
        if (
          !execution ||
          isTerminalExecutionStatus(execution.status as ExecutionStatus)
        ) {
          return;
        }
      } else {
        execution = running;
        this.lifecycleLogger.logTransition(
          executionId,
          ExecutionStatus.QUEUED,
          ExecutionStatus.RUNNING,
        );
      }
    } else if (execution.status === ExecutionStatus.RUNNING) {
      const startedAtMs = execution.startedAt?.getTime() ?? 0;
      const isStale =
        Date.now() - startedAtMs > this.config.workerStaleExecutionMs;
      if (!isStale) {
        return;
      }

      await this.executionRepository.incrementAttempt(executionId);
    }

    const session = await this.codeSessionRepository.findById(
      execution.sessionId,
    );
    if (!session) {
      await this.safeFinalize(executionId, {
        status: ExecutionStatus.FAILED,
        executionTimeMs: 0,
        errorType: 'SESSION_NOT_FOUND',
        errorMessage: `Session ${execution.sessionId} was not found`,
      });
      return;
    }

    try {
      const executor = this.executorRegistry.get(
        session.language as SupportedLanguage,
      );
      const result = await executor.execute({
        sourceCode: session.sourceCode,
        maxMemoryBytes: this.config.maxMemoryBytes,
        maxOutputBytes: this.config.maxOutputBytes,
        maxRuntimeMs: this.config.maxRuntimeMs,
      });

      const finalizePayload = this.mapFinalizePayload(result);
      const finalized = await this.safeFinalize(executionId, finalizePayload);
      if (finalized) {
        this.lifecycleLogger.logTransition(
          executionId,
          ExecutionStatus.RUNNING,
          finalizePayload.status,
          {
            executionTimeMs: finalizePayload.executionTimeMs,
          },
        );
      }
    } catch (error) {
      this.lifecycleLogger.logQueueError(executionId, error);
      const message =
        error instanceof Error ? error.message : 'Unknown execution error';
      await this.safeFinalize(executionId, {
        status: ExecutionStatus.FAILED,
        executionTimeMs: 0,
        stderr: message,
        errorType: 'INTERNAL_EXECUTION_ERROR',
        errorMessage: message,
      });
      throw error;
    }
  }

  private mapFinalizePayload(result: {
    stdout: string;
    stderr: string;
    durationMs: number;
    exitCode: number | null;
    timedOut: boolean;
    memoryLimitExceeded: boolean;
    outputLimitExceeded: boolean;
  }): FinalizeExecutionInput {
    if (result.timedOut) {
      return {
        status: ExecutionStatus.TIMEOUT,
        executionTimeMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        errorType: 'TIMEOUT',
        errorMessage: 'Execution exceeded configured runtime limit.',
      };
    }

    if (result.memoryLimitExceeded) {
      return {
        status: ExecutionStatus.FAILED,
        executionTimeMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        errorType: 'MEMORY_LIMIT_EXCEEDED',
        errorMessage: 'Execution exceeded configured memory limit.',
      };
    }

    if (result.outputLimitExceeded) {
      return {
        status: ExecutionStatus.FAILED,
        executionTimeMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        errorType: 'OUTPUT_LIMIT_EXCEEDED',
        errorMessage: 'Execution output exceeded configured size limit.',
      };
    }

    if (result.exitCode === 0) {
      return {
        status: ExecutionStatus.COMPLETED,
        executionTimeMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    return {
      status: ExecutionStatus.FAILED,
      executionTimeMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      errorType: 'RUNTIME_ERROR',
      errorMessage: `Process exited with code ${result.exitCode ?? 'unknown'}.`,
    };
  }

  private async safeFinalize(
    executionId: string,
    input: FinalizeExecutionInput,
  ): Promise<boolean> {
    const finalized = await this.executionRepository.finalize(
      executionId,
      input,
    );
    return Boolean(finalized);
  }
}
