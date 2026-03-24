const COMPRESSIBLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const COMPRESSED_OUTPUT_MIME_TYPE = 'image/webp';
const COMPRESSED_OUTPUT_QUALITY = 0.84;
const MIN_BYTES_TO_COMPRESS = 48 * 1024;
const MIN_SAVINGS_RATIO = 0.08;

interface CompressionResult {
  blob: Blob;
  mimeType: string;
  compressed: boolean;
  originalBytes: number;
  storedBytes: number;
  savedBytes: number;
}

const loadImageFromBlob = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image decode failed'));
    };

    image.src = objectUrl;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, mimeType: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });

export const compressOfflineImage = async (blob: Blob, mimeType?: string): Promise<CompressionResult> => {
  const normalizedMimeType = (mimeType || blob.type || '').toLowerCase();

  if (
    typeof window === 'undefined'
    || blob.size < MIN_BYTES_TO_COMPRESS
    || !COMPRESSIBLE_MIME_TYPES.has(normalizedMimeType)
  ) {
    return {
      blob,
      mimeType: normalizedMimeType || blob.type || 'image/jpeg',
      compressed: false,
      originalBytes: blob.size,
      storedBytes: blob.size,
      savedBytes: 0,
    };
  }

  try {
    const image = await loadImageFromBlob(blob);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      throw new Error('Invalid image size');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('Canvas context unavailable');
    }

    context.drawImage(image, 0, 0, width, height);

    const compressedBlob = await canvasToBlob(
      canvas,
      COMPRESSED_OUTPUT_MIME_TYPE,
      COMPRESSED_OUTPUT_QUALITY,
    );

    if (!compressedBlob) {
      throw new Error('Canvas encode failed');
    }

    const savedBytes = blob.size - compressedBlob.size;
    const savedRatio = savedBytes / blob.size;

    if (savedBytes <= 0 || savedRatio < MIN_SAVINGS_RATIO) {
      return {
        blob,
        mimeType: normalizedMimeType || blob.type || 'image/jpeg',
        compressed: false,
        originalBytes: blob.size,
        storedBytes: blob.size,
        savedBytes: 0,
      };
    }

    return {
      blob: compressedBlob,
      mimeType: COMPRESSED_OUTPUT_MIME_TYPE,
      compressed: true,
      originalBytes: blob.size,
      storedBytes: compressedBlob.size,
      savedBytes,
    };
  } catch {
    return {
      blob,
      mimeType: normalizedMimeType || blob.type || 'image/jpeg',
      compressed: false,
      originalBytes: blob.size,
      storedBytes: blob.size,
      savedBytes: 0,
    };
  }
};

