import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JavaScriptExecutor } from './executors/javascript.executor';
import { PythonExecutor } from './executors/python.executor';
import { CodeExecutorRegistry } from './executors/code-executor.registry';
import { ExecutionProcessorService } from './execution-processor.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    PythonExecutor,
    JavaScriptExecutor,
    CodeExecutorRegistry,
    ExecutionProcessorService,
    {
      provide: 'EXECUTOR_REGISTRY_BOOTSTRAP',
      inject: [CodeExecutorRegistry, PythonExecutor, JavaScriptExecutor],
      useFactory: (
        registry: CodeExecutorRegistry,
        pythonExecutor: PythonExecutor,
        javascriptExecutor: JavaScriptExecutor,
      ): boolean => {
        registry.register(pythonExecutor);
        registry.register(javascriptExecutor);
        return true;
      },
    },
  ],
  exports: [CodeExecutorRegistry, ExecutionProcessorService],
})
export class RunnerModule {}
