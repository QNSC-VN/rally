import type { Label, CreateLabelInput, UpdateLabelInput } from '../label.types';

export const LABEL_REPOSITORY = Symbol('LABEL_REPOSITORY');

export interface ILabelRepository {
  findById(id: string): Promise<Label | null>;
  listByProject(projectId: string, tenantId: string): Promise<Label[]>;
  create(input: CreateLabelInput): Promise<Label>;
  update(id: string, input: UpdateLabelInput): Promise<Label>;
  delete(id: string): Promise<void>;
}
