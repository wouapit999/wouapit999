import { Logger } from '@nestjs/common';

/** Keep unit-test output readable: Nest's logger is silenced, assertions cover the behaviour. */
Logger.overrideLogger(false);
