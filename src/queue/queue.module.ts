import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';
import { RUN_QUEUE_NAME } from './queue.constants';
import { RUN_QUEUE } from './queue.tokens';
import { createRedisConnection } from './redis-connection.util';
import { RunQueueService } from './run-queue.service';

@Module({
  providers: [
    {
      provide: RUN_QUEUE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Queue => {
        return new Queue(RUN_QUEUE_NAME, {
          connection: createRedisConnection(config),
        });
      },
    },
    RunQueueService,
  ],
  exports: [RUN_QUEUE, RunQueueService],
})
export class QueueModule {}
