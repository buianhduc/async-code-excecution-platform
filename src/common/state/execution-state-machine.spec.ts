import { BadRequestException } from '@nestjs/common';
import { ExecutionStatus } from '../enums/execution-status.enum';
import { ExecutionStateMachine } from './execution-state-machine';

describe('ExecutionStateMachine', () => {
  it('allows valid transitions', () => {
    expect(
      ExecutionStateMachine.canTransition(
        ExecutionStatus.QUEUED,
        ExecutionStatus.RUNNING,
      ),
    ).toBe(true);

    expect(
      ExecutionStateMachine.canTransition(
        ExecutionStatus.RUNNING,
        ExecutionStatus.COMPLETED,
      ),
    ).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      ExecutionStateMachine.assertTransition(
        ExecutionStatus.QUEUED,
        ExecutionStatus.COMPLETED,
      ),
    ).toThrow(BadRequestException);
  });
});
