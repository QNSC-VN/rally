export interface Label {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLabelInput {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color?: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}
