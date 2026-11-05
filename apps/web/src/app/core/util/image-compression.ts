export interface CompressOptions {
  maxSide: number;
  quality: number;
  type: 'image/jpeg' | 'image/webp';
}

const DEFAULTS: CompressOptions = { maxSide: 1280, quality: 0.8, type: 'image/jpeg' };

/** Pure helper (unit-tested): scale to fit maxSide, never upscale. */
export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Phone cameras produce 3–8 MB photos; on a rural 3G link that's a minute of upload.
 * Re-encoding client-side to ≤1280 px / JPEG q0.8 yields ~150–300 kB with no loss of
 * signal for vegetation analysis (the AI service downsamples to 512 px anyway).
 * `createImageBitmap` honours EXIF orientation and decodes off the main thread.
 */
export async function compressImage(
  file: File,
  opts: Partial<CompressOptions> = {},
): Promise<Blob> {
  const o = { ...DEFAULTS, ...opts };
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, o.maxSide);
    if (width === bitmap.width && file.size < 400_000 && file.type === o.type) return file;

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: o.type, quality: o.quality });
    }
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encode failed'))),
        o.type,
        o.quality,
      ),
    );
  } finally {
    bitmap.close();
  }
}
