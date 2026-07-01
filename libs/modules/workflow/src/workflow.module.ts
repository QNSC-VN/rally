import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { WorkflowController } from './interface/http/workflow.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [WorkflowController],
})
export class WorkflowModule {}
