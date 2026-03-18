import { AppConfigService } from '../config/app-config.service';
import { ExecutionLifecycleLogger } from '../observability/execution-lifecycle.logger';
import { ExecutionProcessorService } from './execution-processor.service';
import { RunQueueWorker } from './run-queue.worker';

const mockOn = jest.fn();
const mockClose = jest.fn();
const mockWorker = {
  on: mockOn,
  close: mockClose,
};

const workerConstructor = jest.fn(() => mockWorker);

jest.mock('bullmq', () => ({
  Worker: function (...args: unknown[]) {
    return workerConstructor(...args);
  },
}));

const createRedisConnection = jest.fn(() => ({ host: 'redis' }));

jest.mock('../queue/redis-connection.util', () => ({
  createRedisConnection: (...args: unknown[]) => createRedisConnection(...args),
}));

describe('RunQueueWorker', () => {
  const config = {
    workerConcurrency: 4,
  } as AppConfigService;

  const executionProcessor = {
    processExecution: jest.fn(),
  } as unknown as jest.Mocked<ExecutionProcessorService>;

  const lifecycleLogger = {
    logQueueError: jest.fn(),
  } as unknown as jest.Mocked<ExecutionLifecycleLogger>;

  const service = new RunQueueWorker(
    config,
    executionProcessor,
    lifecycleLogger,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockOn.mockReturnValue(mockWorker);
    mockClose.mockResolvedValue(undefined);
    createRedisConnection.mockReturnValue({ host: 'redis' });
  });

  it('creates a BullMQ worker with the configured concurrency', () => {
    service.onModuleInit();

    expect(workerConstructor).toHaveBeenCalledWith(
      'code-execution-runs',
      expect.any(Function),
      {
        connection: { host: 'redis' },
        concurrency: 4,
      },
    );
    expect(createRedisConnection).toHaveBeenCalledWith(config);
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('processes supported run jobs through the execution processor', async () => {
    service.onModuleInit();

    const processor = workerConstructor.mock.calls[0][1] as (
      job: { name: string; data: { executionId: string } },
    ) => Promise<void>;

    await processor({
      name: 'run-code',
      data: { executionId: 'exec-1' },
    });

    expect(executionProcessor.processExecution).toHaveBeenCalledWith('exec-1');
  });

  it('ignores unexpected job names and closes cleanly on shutdown', async () => {
    service.onModuleInit();

    const processor = workerConstructor.mock.calls[0][1] as (
      job: { name: string; data: { executionId: string } },
    ) => Promise<void>;

    await processor({
      name: 'other-job',
      data: { executionId: 'exec-2' },
    });
    await service.onModuleDestroy();

    expect(executionProcessor.processExecution).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });
});
