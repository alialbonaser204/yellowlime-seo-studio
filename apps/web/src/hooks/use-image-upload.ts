import { useState } from 'react';
import { useRequestUploadUrl } from '@yellowlime/api-client-react';

export function useImageUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestUpload = useRequestUploadUrl();

  const upload = async (file: File) => {
    setIsUploading(true);
    setError(null);

    if (file.size > 2 * 1024 * 1024) {
      setError('Bestand is te groot (maximaal 2 MB).');
      setIsUploading(false);
      return null;
    }

    try {
      const response = await requestUpload.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type,
        }
      });

      if (!response || !response.uploadURL) {
        throw new Error('Geen upload URL ontvangen.');
      }

      const uploadResult = await fetch(response.uploadURL, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
        },
        body: file,
      });

      if (!uploadResult.ok) {
        throw new Error('Uploaden naar opslag mislukt.');
      }

      setIsUploading(false);
      return response.objectPath;
    } catch {
      setIsUploading(false);
      setError('Fout bij het uploaden van de afbeelding.');
      return null;
    }
  };

  return { upload, isUploading, error };
}
