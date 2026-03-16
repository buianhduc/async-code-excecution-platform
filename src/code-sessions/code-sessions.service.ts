import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import {
  CODE_SESSION_REPOSITORY,
  EXECUTION_REPOSITORY,
} from '../database/repositories/repository.tokens';
import type { CodeSessionRepository } from '../database/repositories/code-session.repository';
import { CreateCodeSessionDto } from './dto/create-code-session.dto';
import { UpdateCodeSessionDto } from './dto/update-code-session.dto';
import { SupportedLanguage } from '../common/enums/language.enum';
import type { ExecutionRepository } from '../database/repositories/execution.repository';

const TEMPLATE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  [SupportedLanguage.PYTHON]: "print('Hello World')\n",
  [SupportedLanguage.JAVASCRIPT]: "console.log('Hello World');\n",
};

@Injectable()
export class CodeSessionsService {
  constructor(
    @Inject(CODE_SESSION_REPOSITORY)
    private readonly codeSessionRepository: CodeSessionRepository,
    @Inject(EXECUTION_REPOSITORY)
    private readonly executionRepository: ExecutionRepository,
    private readonly config: AppConfigService,
  ) {}

  async createSession(payload: CreateCodeSessionDto) {
    const sourceCode =
      payload.template_code ?? TEMPLATE_BY_LANGUAGE[payload.language] ?? '';

    this.assertSourceLength(sourceCode);

    return this.codeSessionRepository.create({
      language: payload.language,
      sourceCode,
    });
  }

  async autosaveSession(sessionId: string, payload: UpdateCodeSessionDto) {
    this.assertSourceLength(payload.source_code);

    const session = await this.codeSessionRepository.autosave(
      sessionId,
      payload.language,
      payload.source_code,
    );

    if (!session) {
      throw new NotFoundException(`Code session ${sessionId} was not found.`);
    }

    return session;
  }

  async assertCanRun(sessionId: string): Promise<void> {
    const session = await this.codeSessionRepository.findById(sessionId);
    if (!session) {
      throw new NotFoundException(`Code session ${sessionId} was not found.`);
    }

    this.assertSourceLength(session.sourceCode);

    const since = new Date(Date.now() - this.config.runRateLimitWindowMs);
    const recentRuns = await this.executionRepository.countQueuedSince(
      sessionId,
      since,
    );

    if (recentRuns >= this.config.runRateLimitCount) {
      throw new HttpException(
        'Run request limit exceeded for this session. Please wait and retry.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private assertSourceLength(sourceCode: string): void {
    const sourceLength = Buffer.byteLength(sourceCode, 'utf8');
    if (sourceLength > this.config.maxSourceBytes) {
      throw new PayloadTooLargeException(
        `Source code exceeds limit of ${this.config.maxSourceBytes} bytes.`,
      );
    }
  }
}
