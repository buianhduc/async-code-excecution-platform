import { Injectable } from '@nestjs/common';
import { CodeSessionStatus, SupportedLanguage } from '@prisma/client';
import { CodeSessionRecord } from '../../common/types/domain.types';
import type { SupportedLanguage as AppLanguage } from '../../common/enums/language.enum';
import {
  type CodeSessionRepository,
  type CreateCodeSessionInput,
} from './code-session.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PrismaCodeSessionRepository implements CodeSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCodeSessionInput): Promise<CodeSessionRecord> {
    return this.prisma.codeSession.create({
      data: {
        language: input.language as unknown as SupportedLanguage,
        sourceCode: input.sourceCode,
        status: CodeSessionStatus.ACTIVE,
      },
    });
  }

  async findById(sessionId: string): Promise<CodeSessionRecord | null> {
    return this.prisma.codeSession.findUnique({
      where: { id: sessionId },
    });
  }

  async autosave(
    sessionId: string,
    language: AppLanguage,
    sourceCode: string,
  ): Promise<CodeSessionRecord | null> {
    const updated = await this.prisma.codeSession.updateMany({
      where: { id: sessionId, status: CodeSessionStatus.ACTIVE },
      data: {
        language: language as unknown as SupportedLanguage,
        sourceCode,
        version: {
          increment: 1,
        },
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.findById(sessionId);
  }
}
