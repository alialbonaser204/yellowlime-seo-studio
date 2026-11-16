import { useState } from 'react';
import { useRequestUploadUrl } from '@yellowlime/api-client-react';

const MAX_BYTES = 2 * 1024 * 1024;
/** Profile pictures are only shown small, so 512 px is plenty. */
const MAX_SIDE = 512;
/** Aim for small files so the database does not fill up. */
const TARGET_BYTES = 80 * 1024;

/**
 * Every image is made small before it is uploaded: scaled down to at most
 * 512 px and saved as WebP (or JPEG when the browser cannot write WebP).
 * Transparency is kept with WebP. A typical profile picture becomes 15–60 KB.
 * Formats the browser can open (HEIC on Safari, GIF, AVIF, ...) work too.
 */
async function prepareImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Deze afbeelding kan niet worden geopend. Kies een JPG-, PNG- of WebP-bestand.');
  }
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Deze afbeelding kan niet worden omgezet.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

  let blob: Blob | null = null;
  for (const quality of [0.82, 0.7, 0.55]) {
    blob = await encode('image/webp', quality);
    if (!blob || blob.type !== 'image/webp') { blob = null; break; } // browser cannot write WebP
    if (blob.size <= TARGET_BYTES) break;
  }
  if (!blob) {
    // JPEG has no transparency: put the image on white first.
    const flat = document.createElement('canvas');
    flat.width = canvas.width; flat.height = canvas.height;
    const fctx = flat.getContext('2d')!;
    fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, flat.width, flat.height); fctx.drawImage(canvas, 0, 0);
    for (const quality of [0.82, 0.7, 0.55]) {
      blob = await new Promise<Blob | null>((resolve) => flat.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= TARGET_BYTES) break;
    }
  }
  // Keep the original when it was already smaller (and allowed).
  if (blob && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= blob.size && ratio === 1) return file;
  if (!blob || blob.size > MAX_BYTES) throw new Error('De afbeelding kon niet klein genoeg worden gemaakt.');
  const base = file.name.replace(/\.[^.]+$/, '') || 'afbeelding';
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
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
