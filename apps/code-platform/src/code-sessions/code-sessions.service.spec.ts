import {
  HttpException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { SupportedLanguage } from '../common/enums/language.enum';
import { AppConfigService } from '../config/app-config.service';
import { CodeSessionRepository } from '../database/repositories/code-session.repository';
import { ExecutionRepository } from '../database/repositories/execution.repository';
import { CodeSessionsService } from './code-sessions.service';

describe('CodeSessionsService', () => {
  const codeSessionRepository: jest.Mocked<CodeSessionRepository> = {
    create: jest.fn(),
    findById: jest.fn(),
    autosave: jest.fn(),
  };

  const executionRepository: jest.Mocked<ExecutionRepository> = {
    createQueued: jest.fn(),
    findById: jest.fn(),
    hasInFlightExecution: jest.fn(),
    markRunning: jest.fn(),
    incrementAttempt: jest.fn(),
    finalize: jest.fn(),
    countQueuedSince: jest.fn(),
  };

  const config = {
    maxSourceBytes: 100,
    runRateLimitCount: 2,
    runRateLimitWindowMs: 60_000,
  } as AppConfigService;

  const service = new CodeSessionsService(
    codeSessionRepository,
    executionRepository,
    config,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    executionRepository.hasInFlightExecution.mockResolvedValue(false);
  });

  it('creates a session using template code fallback', async () => {
    codeSessionRepository.create.mockResolvedValue({
      id: 'session-id',
      language: SupportedLanguage.PYTHON,
      sourceCode: "print('Hello World')\n",
      status: 'ACTIVE' as never,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.createSession({ language: SupportedLanguage.PYTHON });

    expect(codeSessionRepository.create).toHaveBeenCalledWith({
      language: SupportedLanguage.PYTHON,
      sourceCode: "print('Hello World')\n",
    });
  });

  it('rejects oversized autosave payload', async () => {
    await expect(
      service.autosaveSession('session-id', {
        language: SupportedLanguage.PYTHON,
        source_code: 'a'.repeat(200),
      }),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('throws not found when autosave session is missing', async () => {
    codeSessionRepository.autosave.mockResolvedValue(null);

    await expect(
      service.autosaveSession('missing', {
        language: SupportedLanguage.PYTHON,
        source_code: 'print(1)',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces run rate limit', async () => {
    codeSessionRepository.findById.mockResolvedValue({
      id: 'session-id',
      language: SupportedLanguage.PYTHON,
      sourceCode: 'print(1)',
      status: 'ACTIVE' as never,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    executionRepository.countQueuedSince.mockResolvedValue(2);

    const runPromise = service.assertCanRun('session-id');
    await expect(runPromise).rejects.toThrow(HttpException);
    await expect(runPromise).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('blocks a run when another execution is already queued or running', async () => {
    codeSessionRepository.findById.mockResolvedValue({
      id: 'session-id',
      language: SupportedLanguage.PYTHON,
      sourceCode: 'print(1)',
      status: 'ACTIVE' as never,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    executionRepository.hasInFlightExecution.mockResolvedValue(true);

    await expect(service.assertCanRun('session-id')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: 'Only allow 1 execution queued at a time',
    });
  });
});
