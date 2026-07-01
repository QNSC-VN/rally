export interface Comment {
  id: string;
  tenantId: string;
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
  tenantId: string;
  workItemId: string;
  authorId: string;
  body: string;
  parentId?: string;
}

export interface Attachment {
  id: string;
  tenantId: string;
  workItemId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface CreateAttachmentInput {
  id: string;
  tenantId: string;
  workItemId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}
