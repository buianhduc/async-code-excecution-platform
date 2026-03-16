import { SupportedLanguage } from '../../common/enums/language.enum';

export interface ExecuteCodeInput {
  sourceCode: string;
  maxRuntimeMs: number;
  maxOutputBytes: number;
  maxMemoryBytes: number;
}

export interface ExecuteCodeResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  memoryLimitExceeded: boolean;
  outputLimitExceeded: boolean;
}

export interface CodeExecutor {
  readonly language: SupportedLanguage;
  execute(input: ExecuteCodeInput): Promise<ExecuteCodeResult>;
}
