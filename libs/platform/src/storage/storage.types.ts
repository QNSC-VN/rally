/** Returned by presignPut — the URL the client PUTs the file to directly. */
export interface PresignPutResult {
  uploadUrl: string;
}

/** Returned by headObject — metadata of an object already in S3. */
export interface HeadObjectResult {
  contentLength: number;
}

/** Presigned PUT URL TTL — keep short so clients must start the upload quickly. */
export const UPLOAD_URL_TTL_SECONDS = 300; // 5 minutes

/** Presigned GET URL TTL — long enough to stream, short enough to limit leak window. */
export const DOWNLOAD_URL_TTL_SECONDS = 900; // 15 minutes
