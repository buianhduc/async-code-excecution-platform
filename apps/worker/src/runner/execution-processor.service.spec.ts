import { SupportedLanguage } from '../common/enums/language.enum';
import { AppConfigService } from '../config/app-config.service';
import type { CodeSessionRepository } from '../database/repositories/code-session.repository';
import type { ExecutionRepository } from '../database/repositories/execution.repository';
import { ExecutionLifecycleLogger } from '../observability/execution-lifecycle.logger';
import { ExecutionProcessorService } from './execution-processor.service';
import { CodeExecutorRegistry } from './executors/code-executor.registry';

describe('ExecutionProcessorService', () => {
  const codeSessionRepository: jest.Mocked<CodeSessionRepository> = {
    findById: jest.fn(),
    autosave: jest.fn(),
  };

  const executionRepository: jest.Mocked<ExecutionRepository> = {
    findById: jest.fn(),
    markRunning: jest.fn(),
    incrementAttempt: jest.fn(),
    finalize: jest.fn(),
  };

  const config = {
    workerStaleExecutionMs: 30_000,
    maxMemoryBytes: 128 * 1024 * 1024,
    maxOutputBytes: 50_000,
    maxRuntimeMs: 5_000,
  } as AppConfigService;

  const executorRegistry = {
    get: jest.fn(),
  } as unknown as jest.Mocked<CodeExecutorRegistry>;

  const lifecycleLogger = {
    logTransition: jest.fn(),
    logQueueError: jest.fn(),
  } as unknown as jest.Mocked<ExecutionLifecycleLogger>;

  const service = new ExecutionProcessorService(
    codeSessionRepository,
    executionRepository,
    config,
    executorRegistry,
    lifecycleLogger,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('marks queued executions as running and finalizes successful runs', async () => {
    const queuedAt = new Date('2026-03-17T10:00:00.000Z');
    executionRepository.findById.mockResolvedValue({
      id: 'exec-1',
      sessionId: 'session-1',
      status: 'QUEUED',
      queuedAt,
      startedAt: null,
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 0,
      errorType: null,
      errorMessage: null,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    executionRepository.markRunning.mockResolvedValue({
      id: 'exec-1',
      sessionId: 'session-1',
      status: 'RUNNING',
      queuedAt,
      startedAt: new Date('2026-03-17T10:00:01.000Z'),
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 1,
      errorType: null,
      errorMessage: null,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    codeSessionRepository.findById.mockResolvedValue({
      id: 'session-1',
      language: SupportedLanguage.PYTHON,
      sourceCode: 'print(1)',
      status: 'ACTIVE',
      version: 1,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    executorRegistry.get.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        stdout: '1\n',
        stderr: '',
        durationMs: 12,
        exitCode: 0,
        signal: null,
        timedOut: false,
        memoryLimitExceeded: false,
        outputLimitExceeded: false,
      }),
    } as never);
    executionRepository.finalize.mockResolvedValue({} as never);

    await service.processExecution('exec-1');

    expect(executionRepository.markRunning).toHaveBeenCalledWith('exec-1', {
      queuedAt: queuedAt.toISOString(),
    });
    expect(executorRegistry.get).toHaveBeenCalledWith(SupportedLanguage.PYTHON);
    expect(executionRepository.finalize).toHaveBeenCalledWith('exec-1', {
      status: 'COMPLETED',
      executionTimeMs: 12,
      stdout: '1\n',
      stderr: '',
    });
    expect(lifecycleLogger.logTransition).toHaveBeenNthCalledWith(
      1,
      'exec-1',
      'QUEUED',
      'RUNNING',
    );
    expect(lifecycleLogger.logTransition).toHaveBeenNthCalledWith(
      2,
      'exec-1',
      'RUNNING',
      'COMPLETED',
      { executionTimeMs: 12 },
    );
  });

  it('finalizes missing sessions as failed without executing code', async () => {
    const startedAt = new Date('2026-03-17T10:00:01.000Z');
    executionRepository.findById.mockResolvedValue({
      id: 'exec-2',
      sessionId: 'missing-session',
      status: 'RUNNING',
      queuedAt: new Date('2026-03-17T10:00:00.000Z'),
      startedAt,
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 1,
      errorType: null,
      errorMessage: null,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    codeSessionRepository.findById.mockResolvedValue(null);
    executionRepository.finalize.mockResolvedValue({} as never);

    await service.processExecution('exec-2');

    expect(executionRepository.finalize).toHaveBeenCalledWith('exec-2', {
      status: 'FAILED',
      executionTimeMs: 0,
      errorType: 'SESSION_NOT_FOUND',
      errorMessage: 'Session missing-session was not found',
    });
    expect(executorRegistry.get).not.toHaveBeenCalled();
  });

  it('records internal execution errors and rethrows them', async () => {
    const queuedAt = new Date('2026-03-17T10:00:00.000Z');
    const executionError = new Error('python crashed');

    executionRepository.findById.mockResolvedValue({
      id: 'exec-3',
      sessionId: 'session-3',
      status: 'QUEUED',
      queuedAt,
      startedAt: null,
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 0,
      errorType: null,
      errorMessage: null,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    executionRepository.markRunning.mockResolvedValue({
      id: 'exec-3',
      sessionId: 'session-3',
      status: 'RUNNING',
      queuedAt,
      startedAt: new Date('2026-03-17T10:00:01.000Z'),
      completedAt: null,
      stdout: null,
      stderr: null,
      executionTimeMs: null,
      attemptCount: 1,
      errorType: null,
      errorMessage: null,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    codeSessionRepository.findById.mockResolvedValue({
      id: 'session-3',
      language: SupportedLanguage.PYTHON,
      sourceCode: 'print(3)',
      status: 'ACTIVE',
      version: 1,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    executorRegistry.get.mockReturnValue({
      execute: jest.fn().mockRejectedValue(executionError),
    } as never);
    executionRepository.finalize.mockResolvedValue({} as never);

    await expect(service.processExecution('exec-3')).rejects.toThrow(
      executionError,
    );

    expect(lifecycleLogger.logQueueError).toHaveBeenCalledWith(
      'exec-3',
      executionError,
    );
    expect(executionRepository.finalize).toHaveBeenCalledWith('exec-3', {
      status: 'FAILED',
      executionTimeMs: 0,
      stderr: 'python crashed',
      errorType: 'INTERNAL_EXECUTION_ERROR',
      errorMessage: 'python crashed',
    });
  });
});
