import { NotFoundException } from '@nestjs/common';
import { SupportedLanguage } from '../common/enums/language.enum';
import { CodeSessionRepository } from '../database/repositories/code-session.repository';
import { ExecutionRepository } from '../database/repositories/execution.repository';
import { RunQueueService } from '../queue/run-queue.service';
import { ExecutionsService } from './executions.service';

describe('ExecutionsService', () => {
  const executionRepository: jest.Mocked<ExecutionRepository> = {
    createQueued: jest.fn(),
    findById: jest.fn(),
    markRunning: jest.fn(),
    incrementAttempt: jest.fn(),
    finalize: jest.fn(),
    countQueuedSince: jest.fn(),
  };

  const codeSessionRepository: jest.Mocked<CodeSessionRepository> = {
    create: jest.fn(),
    findById: jest.fn(),
    autosave: jest.fn(),
  };

  const queueService = {
    enqueueExecution: jest.fn(),
  } as unknown as jest.Mocked<RunQueueService>;

  const service = new ExecutionsService(
    executionRepository,
    codeSessionRepository,
    queueService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('enqueues execution for an existing session', async () => {
    codeSessionRepository.findById.mockResolvedValue({
      id: 'session-id',
      language: SupportedLanguage.PYTHON,
      sourceCode: 'print(1)',
      status: 'ACTIVE' as never,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    executionRepository.createQueued.mockResolvedValue({
      id: 'exec-id',
      sessionId: 'session-id',
      status: 'QUEUED' as never,
      queuedAt: new Date(),
      startedAt: null,
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 0,
      errorType: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const execution = await service.enqueueExecution('session-id');

    expect(execution.id).toBe('exec-id');
    expect(queueService.enqueueExecution).toHaveBeenCalledWith('exec-id');
  });

  it('throws not found when session does not exist', async () => {
    codeSessionRepository.findById.mockResolvedValue(null);

    await expect(service.enqueueExecution('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws not found when execution does not exist', async () => {
    executionRepository.findById.mockResolvedValue(null);

    await expect(service.getExecutionById('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
