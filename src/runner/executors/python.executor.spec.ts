import { AppConfigService } from '../../config/app-config.service';
import { PythonExecutor } from './python.executor';

describe('PythonExecutor', () => {
  const executor = new PythonExecutor({
    pythonBin: 'python3',
  } as AppConfigService);

  it('executes valid python code', async () => {
    const result = await executor.execute({
      sourceCode: "print('Hello from test')",
      maxRuntimeMs: 2_000,
      maxOutputBytes: 5_000,
      maxMemoryBytes: 128 * 1024 * 1024,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello from test');
    expect(result.timedOut).toBe(false);
  });

  it('enforces timeout', async () => {
    const result = await executor.execute({
      sourceCode: 'while True:\n    pass',
      maxRuntimeMs: 150,
      maxOutputBytes: 5_000,
      maxMemoryBytes: 128 * 1024 * 1024,
    });

    expect(result.timedOut).toBe(true);
  });

  it('enforces output size limit', async () => {
    const result = await executor.execute({
      sourceCode: "print('A' * 10000)",
      maxRuntimeMs: 2_000,
      maxOutputBytes: 100,
      maxMemoryBytes: 128 * 1024 * 1024,
    });

    expect(result.outputLimitExceeded).toBe(true);
  });
});
