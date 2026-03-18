import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';
import { ExecutionLifecycleLogger } from '../observability/execution-lifecycle.logger';
import { RUN_JOB_NAME, RUN_QUEUE_NAME } from '../queue/queue.constants';
import { createRedisConnection } from '../queue/redis-connection.util';
import { ExecutionProcessorService } from './execution-processor.service';

@Injectable()
export class RunQueueWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly executionProcessor: ExecutionProcessorService,
    private readonly lifecycleLogger: ExecutionLifecycleLogger,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      RUN_QUEUE_NAME,
      async (job: Job<{ executionId: string }>) => {
        if (job.name !== RUN_JOB_NAME) {
          return;
        }

        await this.executionProcessor.processExecution(job.data.executionId);
      },
      {
        connection: createRedisConnection(this.config),
        concurrency: this.config.workerConcurrency,
      },
    );

    this.worker.on('failed', (job, error) => {
      const executionId = job?.data?.executionId ?? 'unknown';
      this.lifecycleLogger.logQueueError(executionId, error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    await this.worker.close();
    this.worker = null;
  }
}
