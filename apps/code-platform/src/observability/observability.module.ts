import { Global, Module } from '@nestjs/common';
import { ExecutionLifecycleLogger } from './execution-lifecycle.logger';

@Global()
@Module({
  providers: [ExecutionLifecycleLogger],
  exports: [ExecutionLifecycleLogger],
})
export class ObservabilityModule {}
