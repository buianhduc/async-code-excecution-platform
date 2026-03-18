import { Injectable } from '@nestjs/common';
import { CodeSessionRecord } from '../../common/types/domain.types';
import type { CodeSessionRepository } from './code-session.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PrismaCodeSessionRepository implements CodeSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(sessionId: string): Promise<CodeSessionRecord | null> {
    return this.prisma.codeSession.findUnique({
      where: { id: sessionId },
    });
  }

  async autosave(): Promise<CodeSessionRecord | null> {
    throw new Error('Autosave is not supported in the worker service.');
  }
}
