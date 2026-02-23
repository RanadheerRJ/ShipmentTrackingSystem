const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export const MAX_UPLOAD_IMAGE_BYTES = 2 * 1024 * 1024;

export async function fileToImageDataUrl(file: File, fieldLabel: string) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new Error(`${fieldLabel} must be PNG, JPG, WEBP, or GIF`);
  }
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error(`${fieldLabel} must be 2MB or smaller`);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
      } else {
        reject(new Error(`Failed to read ${fieldLabel.toLowerCase()}`));
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read ${fieldLabel.toLowerCase()}`));
    reader.readAsDataURL(file);
  });

  return dataUrl;
}

export function getInitials(name: string | null | undefined, fallback = 'U') {
  if (!name || !name.trim()) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map(p => p[0]?.toUpperCase() || '').join('');
  return initials || fallback;
}
