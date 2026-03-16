import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ExecutionsService } from '../executions/executions.service';
import {
  CodeSessionResponseDto,
  EnqueueExecutionResponseDto,
} from './dto/code-session.responses';
import { CreateCodeSessionDto } from './dto/create-code-session.dto';
import { UpdateCodeSessionDto } from './dto/update-code-session.dto';
import { CodeSessionsService } from './code-sessions.service';
import { ExecutionStatus } from '../common/enums/execution-status.enum';
import { CodeSessionStatus } from '../common/enums/session-status.enum';

@ApiTags('code-sessions')
@Controller('code-sessions')
export class CodeSessionsController {
  constructor(
    private readonly codeSessionsService: CodeSessionsService,
    private readonly executionsService: ExecutionsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new live code session' })
  @ApiOkResponse({ type: CodeSessionResponseDto })
  async createSession(
    @Body() payload: CreateCodeSessionDto,
  ): Promise<CodeSessionResponseDto> {
    const session = await this.codeSessionsService.createSession(payload);
    return {
      session_id: session.id,
      status: session.status as CodeSessionStatus,
    };
  }

  @Patch(':sessionId')
  @ApiOperation({ summary: 'Autosave the current source code' })
  @ApiOkResponse({ type: CodeSessionResponseDto })
  async autosaveSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() payload: UpdateCodeSessionDto,
  ): Promise<CodeSessionResponseDto> {
    const session = await this.codeSessionsService.autosaveSession(
      sessionId,
      payload,
    );

    return {
      session_id: session.id,
      status: session.status as CodeSessionStatus,
      updated_at: session.updatedAt.toISOString(),
    };
  }

  @Post(':sessionId/run')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue current session code for async execution' })
  @ApiAcceptedResponse({ type: EnqueueExecutionResponseDto })
  async runCode(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<EnqueueExecutionResponseDto> {
    await this.codeSessionsService.assertCanRun(sessionId);
    const execution = await this.executionsService.enqueueExecution(sessionId);

    return {
      execution_id: execution.id,
      status: ExecutionStatus.QUEUED,
    };
  }
}
