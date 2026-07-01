/** MIME types accepted for work-item attachments. */
export const ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

/** Max file size per attachment: 25 MB */
export const ATTACHMENT_MAX_SIZE_BYTES = 25 * 1024 * 1024;

/** Max number of completed attachments per work item */
export const ATTACHMENT_MAX_PER_WORK_ITEM = 25;
