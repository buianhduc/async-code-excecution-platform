import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';
import { RUN_JOB_NAME } from './queue.constants';
import { RUN_QUEUE } from './queue.tokens';

@Injectable()
export class RunQueueService implements OnModuleDestroy {
  constructor(
    @Inject(RUN_QUEUE) private readonly queue: Queue,
    private readonly config: AppConfigService,
  ) {}

  async enqueueExecution(executionId: string): Promise<void> {
    const options: JobsOptions = {
      jobId: executionId,
      attempts: this.config.queueAttempts,
      backoff: {
        type: 'exponential',
        delay: 500,
      },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    };

    await this.queue.add(
      RUN_JOB_NAME,
      {
        executionId,
      },
      options,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
