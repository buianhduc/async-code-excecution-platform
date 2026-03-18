import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './database/prisma.module';
import { ObservabilityModule } from './observability/observability.module';
import { RunQueueWorker } from './runner/run-queue.worker';
import { RunnerModule } from './runner/runner.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    AppConfigModule,
    PrismaModule,
    DatabaseModule,
    ObservabilityModule,
    RunnerModule,
  ],
  providers: [RunQueueWorker],
})
export class WorkerModule {}
