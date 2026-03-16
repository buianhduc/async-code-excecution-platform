import { BadRequestException } from '@nestjs/common';
import { ExecutionStatus } from '../enums/execution-status.enum';

const ALLOWED_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.QUEUED]: [ExecutionStatus.RUNNING],
  [ExecutionStatus.RUNNING]: [
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.TIMEOUT,
  ],
  [ExecutionStatus.COMPLETED]: [],
  [ExecutionStatus.FAILED]: [],
  [ExecutionStatus.TIMEOUT]: [],
};

export class ExecutionStateMachine {
  static canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
    if (!ExecutionStateMachine.canTransition(from, to)) {
      throw new BadRequestException(
        `Invalid execution status transition: ${from} -> ${to}`,
      );
    }
  }
}
