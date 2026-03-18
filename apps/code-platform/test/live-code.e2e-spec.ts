import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { CodeSessionsController } from '../src/code-sessions/code-sessions.controller';
import { CodeSessionsService } from '../src/code-sessions/code-sessions.service';
import { SupportedLanguage } from '../src/common/enums/language.enum';
import { CodeSessionStatus } from '../src/common/enums/session-status.enum';
import { ExecutionStatus } from '../src/common/enums/execution-status.enum';
import { AppConfigService } from '../src/config/app-config.service';
import {
  CODE_SESSION_REPOSITORY,
  EXECUTION_REPOSITORY,
} from '../src/database/repositories/repository.tokens';
import type { CodeSessionRepository } from '../src/database/repositories/code-session.repository';
import {
  type ExecutionRepository,
  type FinalizeExecutionInput,
} from '../src/database/repositories/execution.repository';
import { ExecutionsController } from '../src/executions/executions.controller';
import { ExecutionsService } from '../src/executions/executions.service';
import { RunQueueService } from '../src/queue/run-queue.service';
import {
  CodeSessionRecord,
  ExecutionRecord,
} from '../src/common/types/domain.types';

class InMemoryCodeSessionRepository implements CodeSessionRepository {
  private readonly sessions = new Map<string, CodeSessionRecord>();

  async create(input: {
    language: SupportedLanguage;
    sourceCode: string;
  }): Promise<CodeSessionRecord> {
    const now = new Date();
    const session: CodeSessionRecord = {
      id: randomUUID(),
      language: input.language,
      sourceCode: input.sourceCode,
      status: CodeSessionStatus.ACTIVE,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async findById(sessionId: string): Promise<CodeSessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async autosave(
    sessionId: string,
    language: SupportedLanguage,
    sourceCode: string,
  ): Promise<CodeSessionRecord | null> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return null;
    }

    const updated: CodeSessionRecord = {
      ...existing,
      language,
      sourceCode,
      version: existing.version + 1,
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, updated);
    return updated;
  }
}

class InMemoryExecutionRepository implements ExecutionRepository {
  private readonly executions = new Map<string, ExecutionRecord>();

  async createQueued(sessionId: string): Promise<ExecutionRecord> {
    const now = new Date();
    const execution: ExecutionRecord = {
      id: randomUUID(),
      sessionId,
      status: ExecutionStatus.QUEUED,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 0,
      errorType: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    this.executions.set(execution.id, execution);
    return execution;
  }

  async findById(executionId: string): Promise<ExecutionRecord | null> {
    return this.executions.get(executionId) ?? null;
  }

  async hasInFlightExecution(sessionId: string): Promise<boolean> {
    return Array.from(this.executions.values()).some(
      (execution) =>
        execution.sessionId === sessionId &&
        (execution.status === ExecutionStatus.QUEUED ||
          execution.status === ExecutionStatus.RUNNING),
    );
  }

  async markRunning(executionId: string): Promise<ExecutionRecord | null> {
    const existing = this.executions.get(executionId);
    if (!existing || existing.status !== ExecutionStatus.QUEUED) {
      return null;
    }

    const updated: ExecutionRecord = {
      ...existing,
      status: ExecutionStatus.RUNNING,
      startedAt: new Date(),
      attemptCount: existing.attemptCount + 1,
      updatedAt: new Date(),
    };

    this.executions.set(executionId, updated);
    return updated;
  }

  async incrementAttempt(executionId: string): Promise<void> {
    const existing = this.executions.get(executionId);
    if (!existing) {
      return;
    }

    this.executions.set(executionId, {
      ...existing,
      attemptCount: existing.attemptCount + 1,
      updatedAt: new Date(),
    });
  }

  async finalize(
    executionId: string,
    input: FinalizeExecutionInput,
  ): Promise<ExecutionRecord | null> {
    const existing = this.executions.get(executionId);
    if (!existing || existing.status !== ExecutionStatus.RUNNING) {
      return null;
    }

    const updated: ExecutionRecord = {
      ...existing,
      status: input.status,
      stdout: input.stdout ?? null,
      stderr: input.stderr ?? null,
      executionTimeMs: input.executionTimeMs,
      errorType: input.errorType ?? null,
      errorMessage: input.errorMessage ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    };

    this.executions.set(executionId, updated);
    return updated;
  }

  async countQueuedSince(sessionId: string, since: Date): Promise<number> {
    const executions = Array.from(this.executions.values());
    return executions.filter(
      (execution) =>
        execution.sessionId === sessionId &&
        execution.queuedAt.getTime() >= since.getTime(),
    ).length;
  }
}

describe('Live Code API (integration)', () => {
  let codeSessionsController: CodeSessionsController;
  let executionsController: ExecutionsController;
  const queueService = {
    enqueueExecution: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CodeSessionsController, ExecutionsController],
      providers: [
        CodeSessionsService,
        ExecutionsService,
        {
          provide: CODE_SESSION_REPOSITORY,
          useClass: InMemoryCodeSessionRepository,
        },
        {
          provide: EXECUTION_REPOSITORY,
          useClass: InMemoryExecutionRepository,
        },
        {
          provide: RunQueueService,
          useValue: queueService,
        },
        {
          provide: AppConfigService,
          useValue: {
            maxSourceBytes: 50_000,
            runRateLimitCount: 1,
            runRateLimitWindowMs: 60_000,
          } as AppConfigService,
        },
      ],
    }).compile();

    codeSessionsController = moduleFixture.get(CodeSessionsController);
    executionsController = moduleFixture.get(ExecutionsController);
  });

  it('creates and autosaves a session', async () => {
    const created = await codeSessionsController.createSession({
      language: SupportedLanguage.PYTHON,
    });

    expect(created.status).toBe(CodeSessionStatus.ACTIVE);

    const updated = await codeSessionsController.autosaveSession(
      created.session_id,
      {
        language: SupportedLanguage.PYTHON,
        source_code: "print('updated')",
      },
    );

    expect(updated.session_id).toBe(created.session_id);
    expect(updated.updated_at).toBeDefined();
  });

  it('queues execution and reads queued status', async () => {
    const created = await codeSessionsController.createSession({
      language: SupportedLanguage.PYTHON,
    });

    const queued = await codeSessionsController.runCode(created.session_id);

    expect(queued.status).toBe(ExecutionStatus.QUEUED);
    expect(queueService.enqueueExecution).toHaveBeenCalledTimes(1);

    const execution = await executionsController.getExecution(
      queued.execution_id,
    );
    expect(execution.status).toBe(ExecutionStatus.QUEUED);
  });

  it('blocks repeated run requests when another execution is already in flight', async () => {
    const created = await codeSessionsController.createSession({
      language: SupportedLanguage.PYTHON,
    });

    await codeSessionsController.runCode(created.session_id);

    await expect(
      codeSessionsController.runCode(created.session_id),
    ).rejects.toMatchObject({
      status: 429,
      response: 'Only allow 1 execution queued at a time',
    });
  });
});
