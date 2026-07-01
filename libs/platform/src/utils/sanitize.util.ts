/**
 * Strips dangerous HTML markup from string inputs (OWASP A03 — XSS prevention).
 * Applied before the value reaches any controller handler.
 *
 * Removes:
 *   - <script>, <iframe>, <object>, <embed>, <form>, <input>, <textarea>, <style>
 *   - Inline event handlers:  onclick="...", onload='...', onerror=xxx
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/<\s*script[^>]*>.*?<\s*\/\s*script>/gis, '')
    .replace(/<\s*\/?\s*(script|iframe|object|embed|form|input|textarea|style)\b[^>]*>/gis, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gis, '')
    .replace(/\bon\w+\s*=\s*[^\s>]+/gis, '')
    .trim();
}

/**
 * Recursively sanitize all string values in a plain object or array.
 * Non-string primitives, Dates, and class instances pass through unchanged.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === 'string'
          ? sanitizeString(item)
          : item && typeof item === 'object' && item.constructor === Object
            ? sanitizeObject(item as Record<string, unknown>)
            : item,
      );
    } else if (value && typeof value === 'object' && value.constructor === Object) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}
