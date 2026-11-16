import { useState } from 'react';
import { useRequestUploadUrl } from '@yellowlime/api-client-react';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1600;

/**
 * The server only accepts JPEG, PNG and WebP up to 2 MB. Photos in another
 * format the browser can open (HEIC on Safari, GIF, AVIF, ...) or photos that
 * are too large are converted here first: scaled down and saved as JPEG
 * (or PNG when the image has transparency).
 */
async function prepareImage(file: File): Promise<File> {
  if (ALLOWED.includes(file.type) && file.size <= MAX_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Deze afbeelding kan niet worden geopend. Kies een JPG-, PNG- of WebP-bestand.');
  }
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Deze afbeelding kan niet worden omgezet.');
  const png = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
  if (!png) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = png ? await encode('image/png') : null;
  if (!blob || blob.size > MAX_BYTES) {
    for (const quality of [0.85, 0.75, 0.6]) {
      blob = await encode('image/jpeg', quality);
      if (blob && blob.size <= MAX_BYTES) break;
    }
  }
  if (!blob || blob.size > MAX_BYTES) throw new Error('De afbeelding is te groot, ook na verkleinen (maximaal 2 MB).');
  const base = file.name.replace(/\.[^.]+$/, '') || 'afbeelding';
  const extension = blob.type === 'image/png' ? 'png' : 'jpg';
  return new File([blob], `${base}.${extension}`, { type: blob.type });
}

export function useImageUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestUpload = useRequestUploadUrl();

  const upload = async (original: File) => {
    setIsUploading(true);
    setError(null);

    try {
      const file = await prepareImage(original);
      const response = await requestUpload.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type,
        },
      });

      if (!response || !response.uploadURL) {
        throw new Error('Geen upload-adres ontvangen. Probeer het opnieuw.');
      }

      const uploadResult = await fetch(response.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadResult.ok) {
        const body = await uploadResult.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ? `Uploaden mislukt: ${body.error}` : 'Uploaden naar de opslag is mislukt. Probeer het opnieuw.');
      }

      setIsUploading(false);
      return response.objectPath;
    } catch (caught) {
      setIsUploading(false);
      setError(caught instanceof Error && caught.message ? caught.message : 'Fout bij het uploaden van de afbeelding.');
      return null;
    }
  };

  return { upload, isUploading, error };
}
