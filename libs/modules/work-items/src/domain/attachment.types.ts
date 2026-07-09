export interface Attachment {
  id: string;
  workspaceId: string;
  workItemId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: 'pending' | 'completed';
  deletedAt: Date | null;
  createdAt: Date;
}

export interface CreateAttachmentInput {
  id: string;
  workspaceId: string;
  workItemId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}
