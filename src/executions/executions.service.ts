import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  EXECUTION_REPOSITORY,
  CODE_SESSION_REPOSITORY,
} from '../database/repositories/repository.tokens';
import type { ExecutionRepository } from '../database/repositories/execution.repository';
import { RunQueueService } from '../queue/run-queue.service';
import type { CodeSessionRepository } from '../database/repositories/code-session.repository';

@Injectable()
export class ExecutionsService {
  constructor(
    @Inject(EXECUTION_REPOSITORY)
    private readonly executionRepository: ExecutionRepository,
    @Inject(CODE_SESSION_REPOSITORY)
    private readonly codeSessionRepository: CodeSessionRepository,
    private readonly queueService: RunQueueService,
  ) {}

  async enqueueExecution(sessionId: string) {
    const session = await this.codeSessionRepository.findById(sessionId);
    if (!session) {
      throw new NotFoundException(`Code session ${sessionId} was not found.`);
    }

    const execution = await this.executionRepository.createQueued(sessionId);
    await this.queueService.enqueueExecution(execution.id);
    return execution;
  }

  async getExecutionById(executionId: string) {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} was not found.`);
    }

    return execution;
  }
}
