import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExecutionStatus } from '../common/enums/execution-status.enum';
import { ExecutionResponseDto } from './dto/execution-response.dto';
import { ExecutionsService } from './executions.service';

@ApiTags('executions')
@Controller('executions')
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Get(':executionId')
  @ApiOperation({ summary: 'Get current execution status and result' })
  @ApiOkResponse({ type: ExecutionResponseDto })
  async getExecution(
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ): Promise<ExecutionResponseDto> {
    const execution =
      await this.executionsService.getExecutionById(executionId);

    const response: ExecutionResponseDto = {
      execution_id: execution.id,
      status: execution.status as ExecutionStatus,
      queued_at: execution.queuedAt.toISOString(),
      started_at: execution.startedAt?.toISOString(),
      completed_at: execution.completedAt?.toISOString(),
      error_type: execution.errorType ?? undefined,
      error_message: execution.errorMessage ?? undefined,
    };

    if (
      execution.status === ExecutionStatus.COMPLETED ||
      execution.status === ExecutionStatus.FAILED ||
      execution.status === ExecutionStatus.TIMEOUT
    ) {
      response.stdout = execution.stdout ?? '';
      response.stderr = execution.stderr ?? '';
      response.execution_time_ms = execution.executionTimeMs ?? 0;
    }

    return response;
  }
}
