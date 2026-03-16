import { SupportedLanguage } from '../../common/enums/language.enum';
import { CodeSessionRecord } from '../../common/types/domain.types';

export interface CreateCodeSessionInput {
  language: SupportedLanguage;
  sourceCode: string;
}

export interface CodeSessionRepository {
  create(input: CreateCodeSessionInput): Promise<CodeSessionRecord>;
  findById(sessionId: string): Promise<CodeSessionRecord | null>;
  autosave(
    sessionId: string,
    language: SupportedLanguage,
    sourceCode: string,
  ): Promise<CodeSessionRecord | null>;
}
