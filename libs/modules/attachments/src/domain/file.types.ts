export interface StoredFile {
  id: string;
  workspaceId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  visibility: 'private' | 'public';
  status: 'pending' | 'completed';
  uploadedBy: string;
  createdAt: Date;
  confirmedAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateFileInput {
  id: string;
  workspaceId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  visibility: 'private' | 'public';
  uploadedBy: string;
}

/** What a caller needs to start an upload. */
export interface PresignedUpload {
  fileId: string;
  uploadUrl: string;
  /** Client MUST send these exact headers on the PUT or the signature fails. */
  requiredHeaders: Record<string, string>;
}
