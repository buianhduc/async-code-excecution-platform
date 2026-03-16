import { ApiProperty } from '@nestjs/swagger';
import { CodeSessionStatus } from '../../common/enums/session-status.enum';
import { ExecutionStatus } from '../../common/enums/execution-status.enum';

export class CodeSessionResponseDto {
  @ApiProperty()
  session_id!: string;

  @ApiProperty({ enum: CodeSessionStatus })
  status!: CodeSessionStatus;

  @ApiProperty({ required: false })
  updated_at?: string;
}

export class EnqueueExecutionResponseDto {
  @ApiProperty()
  execution_id!: string;

  @ApiProperty({ enum: [ExecutionStatus.QUEUED] })
  status!: ExecutionStatus.QUEUED;
}
