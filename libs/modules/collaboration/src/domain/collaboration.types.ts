export interface Comment {
  id: string;
  workspaceId: string;
  workItemId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  isEdited: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCommentInput {
  id: string;
  workspaceId: string;
  workItemId: string;
  authorId: string;
  body: string;
  parentId?: string;
}
