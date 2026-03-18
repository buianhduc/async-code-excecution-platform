import { Injectable } from '@nestjs/common';
import { ExecutionStatus, Prisma } from '@prisma/client';
import { ExecutionRecord } from '../../common/types/domain.types';
import {
  type ExecutionRepository,
  type FinalizeExecutionInput,
} from './execution.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PrismaExecutionRepository implements ExecutionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createQueued(sessionId: string): Promise<ExecutionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const execution = await tx.execution.create({
        data: {
          sessionId,
          status: ExecutionStatus.QUEUED,
          queuedAt: new Date(),
        },
      });

      await tx.executionEvent.create({
        data: {
          executionId: execution.id,
          toStatus: ExecutionStatus.QUEUED,
          metadataJson: {
            reason: 'Execution queued',
          } as Prisma.InputJsonValue,
        },
      });

      return execution;
    });
  }

  async findById(executionId: string): Promise<ExecutionRecord | null> {
    return this.prisma.execution.findUnique({
      where: { id: executionId },
    });
  }

  async hasInFlightExecution(sessionId: string): Promise<boolean> {
    const execution = await this.prisma.execution.findFirst({
      where: {
        sessionId,
        status: {
          in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING],
        },
      },
      select: { id: true },
    });

    return Boolean(execution);
  }

  async markRunning(
    executionId: string,
    metadataJson?: Record<string, unknown>,
  ): Promise<ExecutionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.execution.updateMany({
        where: {
          id: executionId,
          status: ExecutionStatus.QUEUED,
        },
        data: {
          status: ExecutionStatus.RUNNING,
          startedAt: new Date(),
          attemptCount: {
            increment: 1,
          },
        },
      });

      if (updated.count === 0) {
        return null;
      }

      await tx.executionEvent.create({
        data: {
          executionId,
          fromStatus: ExecutionStatus.QUEUED,
          toStatus: ExecutionStatus.RUNNING,
          metadataJson: metadataJson as Prisma.InputJsonValue | undefined,
        },
      });

      return tx.execution.findUnique({ where: { id: executionId } });
    });
  }

  async incrementAttempt(executionId: string): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        attemptCount: {
          increment: 1,
        },
      },
    });
  }

  async finalize(
    executionId: string,
    input: FinalizeExecutionInput,
  ): Promise<ExecutionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.execution.findUnique({
        where: { id: executionId },
      });

      if (!current || current.status !== ExecutionStatus.RUNNING) {
        return null;
      }

      const execution = await tx.execution.update({
        where: { id: executionId },
        data: {
          status: input.status as unknown as ExecutionStatus,
          completedAt: new Date(),
          stdout: input.stdout ?? null,
          stderr: input.stderr ?? null,
          executionTimeMs: input.executionTimeMs,
          errorType: input.errorType ?? null,
          errorMessage: input.errorMessage ?? null,
        },
      });

      await tx.executionEvent.create({
        data: {
          executionId,
          fromStatus: ExecutionStatus.RUNNING,
          toStatus: input.status as unknown as ExecutionStatus,
          metadataJson: input.metadataJson as Prisma.InputJsonValue | undefined,
        },
      });

      return execution;
    });
  }

  async countQueuedSince(sessionId: string, since: Date): Promise<number> {
    return this.prisma.execution.count({
      where: {
        sessionId,
        queuedAt: {
          gte: since,
        },
      },
    });
  }
}
