import { ConnectionOptions } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';

export function createRedisConnection(
  config: AppConfigService,
): ConnectionOptions {
  return {
    host: config.redisHost,
    port: config.redisPort,
    username: config.redisUsername,
    password: config.redisPassword,
    maxRetriesPerRequest: null,
  };
}
