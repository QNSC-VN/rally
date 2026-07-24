import { Module } from '@nestjs/common';
import { ScmService } from './application/scm.service';
import { ScmLinkerService } from './application/scm-linker.service';
import { ScmController } from './interface/http/scm.controller';
import { ScmWebhookController } from './interface/http/scm-webhook.controller';
import { ScmDrizzleRepository } from './infrastructure/persistence/scm.drizzle-repository';
import { SCM_STORE } from './domain/ports/scm.store';

@Module({
  controllers: [ScmController, ScmWebhookController],
  providers: [ScmService, ScmLinkerService, { provide: SCM_STORE, useClass: ScmDrizzleRepository }],
  // ScmLinkerService + SCM_STORE are exported so the worker relay can drive linking.
  exports: [ScmService, ScmLinkerService, SCM_STORE],
})
export class ScmModule {}
