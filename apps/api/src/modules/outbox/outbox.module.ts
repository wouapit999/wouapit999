import { Global, Module } from '@nestjs/common';

import { OutboxRelay } from './outbox.relay.js';
import { OutboxService } from './outbox.service.js';
import { LogOutboxTransport, OUTBOX_TRANSPORT } from './outbox.transport.js';

@Global()
@Module({
  providers: [
    OutboxService,
    OutboxRelay,
    { provide: OUTBOX_TRANSPORT, useClass: LogOutboxTransport },
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
