import { Injectable } from '@nestjs/common';
import { SupportedLanguage } from '../../common/enums/language.enum';
import { CodeExecutor } from './code-executor.interface';

@Injectable()
export class CodeExecutorRegistry {
  private readonly executors = new Map<SupportedLanguage, CodeExecutor>();

  register(executor: CodeExecutor): void {
    this.executors.set(executor.language, executor);
  }

  get(language: SupportedLanguage): CodeExecutor {
    const executor = this.executors.get(language);
    if (!executor) {
      throw new Error(`No executor is available for language: ${language}`);
    }

    return executor;
  }
}
