import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get workerConcurrency(): number {
    return this.getNumber('WORKER_CONCURRENCY', 4);
  }

  get workerStaleExecutionMs(): number {
    return this.getNumber('WORKER_STALE_EXECUTION_MS', 30_000);
  }

  get maxOutputBytes(): number {
    return this.getNumber('MAX_OUTPUT_BYTES', 50_000);
  }

  get maxRuntimeMs(): number {
    return this.getNumber('MAX_RUNTIME_MS', 5_000);
  }

  get maxMemoryBytes(): number {
    return this.getNumber('MAX_MEMORY_BYTES', 128 * 1024 * 1024);
  }

  get redisHost(): string {
    return this.configService.get<string>('REDIS_HOST', 'localhost');
  }

  get redisPort(): number {
    return this.getNumber('REDIS_PORT', 6379);
  }

  get redisUsername(): string | undefined {
    return this.configService.get<string>('REDIS_USERNAME');
  }

  get redisPassword(): string | undefined {
    return this.configService.get<string>('REDIS_PASSWORD');
  }

  get pythonBin(): string {
    return this.configService.get<string>('PYTHON_BIN', 'python3');
  }

  get nodeBin(): string {
    return this.configService.get<string>('NODE_BIN', 'node');
  }

  private getNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
