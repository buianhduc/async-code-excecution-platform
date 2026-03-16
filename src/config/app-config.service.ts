import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get port(): number {
    return this.getNumber('PORT', 3000);
  }

  get workerConcurrency(): number {
    return this.getNumber('WORKER_CONCURRENCY', 4);
  }

  get workerStaleExecutionMs(): number {
    return this.getNumber('WORKER_STALE_EXECUTION_MS', 30_000);
  }

  get maxSourceBytes(): number {
    return this.getNumber('MAX_SOURCE_BYTES', 50_000);
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

  get runRateLimitCount(): number {
    return this.getNumber('RUN_RATE_LIMIT_COUNT', 10);
  }

  get runRateLimitWindowMs(): number {
    return this.getNumber('RUN_RATE_LIMIT_WINDOW_MS', 60_000);
  }

  get queueAttempts(): number {
    return this.getNumber('QUEUE_ATTEMPTS', 3);
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

  private getNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
