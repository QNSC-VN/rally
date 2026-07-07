import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { AccessModule } from '@modules/access';
import { WorkflowController } from './interface/http/workflow.controller';

@Module({
  imports: [ProjectsModule, AccessModule],
  controllers: [WorkflowController],
})
export class WorkflowModule {}
