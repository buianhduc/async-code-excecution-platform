import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionsModule } from '../executions/executions.module';
import { CodeSessionsController } from './code-sessions.controller';
import { CodeSessionsService } from './code-sessions.service';

@Module({
  imports: [DatabaseModule, ExecutionsModule],
  controllers: [CodeSessionsController],
  providers: [CodeSessionsService],
  exports: [CodeSessionsService],
})
export class CodeSessionsModule {}
