/** Which bucket an object lives in. Mirrors storage.files.visibility. */
export type StorageVisibility = 'private' | 'public';

export interface PresignPutRequest {
  key: string;
  mimeType: string;
  sizeBytes: number;
  /** Base64 SHA-256. Bound into the signature — the bucket rejects a mismatched body. */
  checksumSha256: string;
  visibility: StorageVisibility;
}

export interface PresignPutResult {
  uploadUrl: string;
  /**
   * Headers the client MUST send on the PUT. They are part of the signature, so
   * omitting or altering any of them fails with SignatureDoesNotMatch. Returned
   * explicitly rather than documented, so the client never has to guess.
   */
  requiredHeaders: Record<string, string>;
}

export interface PresignGetRequest {
  key: string;
  /** Original filename — surfaced to the browser via Content-Disposition. */
  filename: string;
  mimeType: string;
  /** Render in the browser instead of forcing a download. Default: false. */
  inline: boolean;
  visibility: StorageVisibility;
}

/** Returned by headObject — metadata of an object already in the bucket. */
export interface HeadObjectResult {
  contentLength: number;
  checksumSha256: string | null;
}

/** Presigned PUT URL TTL — keep short so clients must start the upload quickly. */
export const UPLOAD_URL_TTL_SECONDS = 300; // 5 minutes

/** Presigned GET URL TTL — long enough to stream, short enough to limit leak window. */
export const DOWNLOAD_URL_TTL_SECONDS = 900; // 15 minutes
