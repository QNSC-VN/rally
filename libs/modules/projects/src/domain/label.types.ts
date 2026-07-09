export interface Label {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLabelInput {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  color?: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}
