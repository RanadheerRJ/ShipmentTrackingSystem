const DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface OptionalImageFieldResult {
  provided: boolean;
  value: string | null;
  error?: string;
}

function validateImageDataUrl(dataUrl: string, fieldLabel: string, maxBytes: number) {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    return { ok: false as const, error: `${fieldLabel} must be a valid base64 image` };
  }

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return { ok: false as const, error: `${fieldLabel} must be PNG, JPG, WEBP, or GIF` };
  }

  const base64Payload = match[2].replace(/\s+/g, '');
  const byteLength = Buffer.byteLength(base64Payload, 'base64');
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return { ok: false as const, error: `${fieldLabel} is invalid` };
  }
  if (byteLength > maxBytes) {
    return { ok: false as const, error: `${fieldLabel} must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller` };
  }

  return { ok: true as const, value: `data:${mimeType};base64,${base64Payload}` };
}

export function normalizeOptionalImageField(rawValue: unknown, fieldLabel: string, maxBytes = MAX_IMAGE_BYTES): OptionalImageFieldResult {
  if (rawValue === undefined) {
    return { provided: false, value: null };
  }

  if (rawValue === null) {
    return { provided: true, value: null };
  }

  if (typeof rawValue !== 'string') {
    return { provided: true, value: null, error: `${fieldLabel} must be a string` };
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { provided: true, value: null };
  }

  const validated = validateImageDataUrl(trimmed, fieldLabel, maxBytes);
  if (!validated.ok) {
    return { provided: true, value: null, error: validated.error };
  }

  return { provided: true, value: validated.value };
}
