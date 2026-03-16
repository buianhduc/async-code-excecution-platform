import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { AppConfigService } from '../../config/app-config.service';
import { SupportedLanguage } from '../../common/enums/language.enum';
import {
  CodeExecutor,
  ExecuteCodeInput,
  ExecuteCodeResult,
} from './code-executor.interface';

@Injectable()
export class PythonExecutor implements CodeExecutor {
  readonly language = SupportedLanguage.PYTHON;

  constructor(private readonly config: AppConfigService) {}

  async execute(input: ExecuteCodeInput): Promise<ExecuteCodeResult> {
    const workDir = await mkdtemp(join(tmpdir(), 'exec-'));
    const sourcePath = join(workDir, 'main.py');

    await fs.writeFile(sourcePath, input.sourceCode, 'utf8');

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let memoryLimitExceeded = false;
    let outputLimitExceeded = false;

    const startedAt = Date.now();

    try {
      const result = await new Promise<{
        exitCode: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        const child = spawn(this.config.pythonBin, ['-I', sourcePath], {
          cwd: workDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {},
        });

        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, input.maxRuntimeMs);

        const monitor = setInterval(() => {
          if (!child.pid) {
            return;
          }

          void fs
            .readFile(`/proc/${child.pid}/status`, 'utf8')
            .then((statusFile) => {
              const match = statusFile.match(/VmRSS:\s+(\d+)\s+kB/i);
              if (!match) {
                return;
              }

              const residentSetBytes = Number(match[1]) * 1024;
              if (residentSetBytes > input.maxMemoryBytes) {
                memoryLimitExceeded = true;
                child.kill('SIGKILL');
              }
            })
            .catch(() => {
              // /proc lookup may not exist in all environments.
            });
        }, 100);

        child.stdout.on('data', (buffer: Buffer) => {
          if (outputLimitExceeded) {
            return;
          }

          stdout += buffer.toString('utf8');
          if (Buffer.byteLength(stdout) > input.maxOutputBytes) {
            outputLimitExceeded = true;
            child.kill('SIGKILL');
          }
        });

        child.stderr.on('data', (buffer: Buffer) => {
          if (outputLimitExceeded) {
            return;
          }

          stderr += buffer.toString('utf8');
          if (Buffer.byteLength(stderr) > input.maxOutputBytes) {
            outputLimitExceeded = true;
            child.kill('SIGKILL');
          }
        });

        child.once('error', (error) => {
          clearTimeout(timeout);
          clearInterval(monitor);
          reject(error);
        });

        child.once('close', (exitCode, signal) => {
          clearTimeout(timeout);
          clearInterval(monitor);
          resolve({ exitCode, signal });
        });
      });

      return {
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut,
        memoryLimitExceeded,
        outputLimitExceeded,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
