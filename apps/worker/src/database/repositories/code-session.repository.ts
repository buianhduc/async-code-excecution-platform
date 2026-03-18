import { SupportedLanguage } from '../../common/enums/language.enum';
import { CodeSessionRecord } from '../../common/types/domain.types';

export interface CodeSessionRepository {
  findById(sessionId: string): Promise<CodeSessionRecord | null>;
  autosave(
    sessionId: string,
    language: SupportedLanguage,
    sourceCode: string,
  ): Promise<CodeSessionRecord | null>;
}
