import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/app-config.module';
import { CodeSessionsModule } from './code-sessions/code-sessions.module';
import { ExecutionsModule } from './executions/executions.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { ObservabilityModule } from './observability/observability.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './database/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    AppConfigModule,
    PrismaModule,
    DatabaseModule,
    QueueModule,
    ObservabilityModule,
    HealthModule,
    ExecutionsModule,
    CodeSessionsModule,
  ],
})
export class AppModule {}
