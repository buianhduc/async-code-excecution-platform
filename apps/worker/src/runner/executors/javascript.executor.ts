import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SupportedLanguage } from '../../common/enums/language.enum';
import { AppConfigService } from '../../config/app-config.service';
import {
  CodeExecutor,
  ExecuteCodeInput,
  ExecuteCodeResult,
} from './code-executor.interface';
import {
  Isolate
} from 'isolated-vm'
import { time } from 'node:console';
import { timeout } from 'rxjs';
@Injectable()
export class JavaScriptExecutor implements CodeExecutor {
  readonly language = SupportedLanguage.JAVASCRIPT;

  constructor(private readonly config: AppConfigService) {}

  async execute(input: ExecuteCodeInput): Promise<ExecuteCodeResult> {

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let memoryLimitExceeded = false;
    let outputLimitExceeded = false;
    
    // Create a new isolated VM
    const ivm = new Isolate({
      memoryLimit: (this.config.maxMemoryBytes / 1024) / 1024 // Convert bytes to mb
    })
    
    // Allow isolated environment to write to stdout and stderr
    const context = ivm.createContextSync()
    const jail = context.global;
    jail.setSync("global", jail.derefInto())
    jail.setSync("isolatedLog", function (...args) {
      let newStr = [...args].join()
      stdout += newStr
      if (stdout.length > input.maxOutputBytes) {
        memoryLimitExceeded = true
        ivm.dispose()
      }
    })
    jail.setSync("isolatedError", function (...args) {
      stderr += args.join()
    })
    // Bootstrap console object to redirect stdin and error to respective host's machine result pooling
    const bootstrapScript = `const console = {
      log: (...args) => isolatedLog(...args),
      error: (...args) => isolatedError(...args)
    };
    `

    const execution = ivm.compileScriptSync(bootstrapScript+input.sourceCode)
    
    // Init the result
    let result: ExecuteCodeResult = {
        stdout: stdout,
        stderr: stderr,
        timedOut: timedOut,
        durationMs: Number(ivm.cpuTime),
        memoryLimitExceeded: memoryLimitExceeded,
        outputLimitExceeded: outputLimitExceeded,
        exitCode: null,
        signal: null
      }
    
    try {
      // Ignore the result because the result of execution.run is the result of the last expression, 
      // which does not in the scope for our current use case
      const _ = await execution.run(context, {
        timeout: input.maxRuntimeMs
      })
      memoryLimitExceeded = ivm.getHeapStatisticsSync().used_heap_size > input.maxMemoryBytes
      result = {
        stdout: stdout,
        stderr: stderr,
        timedOut: timedOut,
        durationMs: Number(ivm.wallTime / 1000000n),
        memoryLimitExceeded: memoryLimitExceeded,
        outputLimitExceeded: outputLimitExceeded,
        exitCode: 0,
        signal: null
      }
    } catch (err) {
      console.debug(ivm.wallTime)
      result = {
        stdout: stdout,
        stderr: stderr + err.toString(),
        timedOut: timedOut,
        durationMs: Number(ivm.wallTime / 1000000n),
        memoryLimitExceeded: memoryLimitExceeded,
        outputLimitExceeded: outputLimitExceeded,
        exitCode: 1,
        signal: null
      }
    }

    // Clean up
    ivm.dispose()
    context.release() 

    return result
  }
}
