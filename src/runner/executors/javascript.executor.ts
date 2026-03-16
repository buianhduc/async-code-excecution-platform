import { Injectable } from '@nestjs/common';
import { SupportedLanguage } from '../../common/enums/language.enum';
import {
  CodeExecutor,
  ExecuteCodeInput,
  ExecuteCodeResult,
} from './code-executor.interface';

@Injectable()
export class JavaScriptExecutor implements CodeExecutor {
  readonly language = SupportedLanguage.JAVASCRIPT;

  async execute(_input: ExecuteCodeInput): Promise<ExecuteCodeResult> {
    throw new Error(
      'JavaScript executor is not implemented yet. Extend the runner adapter in v2.',
    );
  }
}
