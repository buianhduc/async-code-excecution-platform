import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import {
  CODE_SESSION_REPOSITORY,
  EXECUTION_REPOSITORY,
} from './repositories/repository.tokens';
import { PrismaCodeSessionRepository } from './repositories/prisma-code-session.repository';
import { PrismaExecutionRepository } from './repositories/prisma-execution.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    PrismaCodeSessionRepository,
    PrismaExecutionRepository,
    {
      provide: CODE_SESSION_REPOSITORY,
      useExisting: PrismaCodeSessionRepository,
    },
    {
      provide: EXECUTION_REPOSITORY,
      useExisting: PrismaExecutionRepository,
    },
  ],
  exports: [CODE_SESSION_REPOSITORY, EXECUTION_REPOSITORY],
})
export class DatabaseModule {}
