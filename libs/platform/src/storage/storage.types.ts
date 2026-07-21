/** Which bucket an object lives in. Mirrors storage.files.visibility. */
export type StorageVisibility = 'private' | 'public';

export interface PresignPutRequest {
  key: string;
  mimeType: string;
  sizeBytes: number;
  visibility: StorageVisibility;
  // No checksum here on purpose — a presigned PUT cannot carry one. See
  // StorageService.presignPut for the evidence and what happened when it tried.
}

export interface PresignPutResult {
  uploadUrl: string;
  /**
   * The EXACT header set the signature covers. The client must send these and
   * nothing else: an extra `x-amz-*` header the signature does not cover is
   * rejected 403, and on a bucket origin that failure reaches the browser as an
   * opaque "Failed to fetch". Returned explicitly so the client never guesses.
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
