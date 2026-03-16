import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExecutionStatus } from '../../common/enums/execution-status.enum';

export class ExecutionResponseDto {
  @ApiProperty()
  execution_id!: string;

  @ApiProperty({ enum: ExecutionStatus })
  status!: ExecutionStatus;

  @ApiPropertyOptional()
  stdout?: string;

  @ApiPropertyOptional()
  stderr?: string;

  @ApiPropertyOptional()
  execution_time_ms?: number;

  @ApiPropertyOptional()
  queued_at?: string;

  @ApiPropertyOptional()
  started_at?: string;

  @ApiPropertyOptional()
  completed_at?: string;

  @ApiPropertyOptional()
  error_type?: string;

  @ApiPropertyOptional()
  error_message?: string;
}
