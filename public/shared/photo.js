/**
 * Report photos, prepared ON THE PHONE before anything is sent: drawn onto a canvas at no more than 1024 px on the long
 * side and saved again as a JPEG. Saving from a canvas writes a brand-new file, so the camera's EXIF data (GPS place,
 * time, phone model) is not carried over.
 *
 * The decisions (the size, how the quality steps down, when to give up) are pure and tested; the browser part at the
 * bottom (`preparePhoto`) only decodes, draws and encodes.
 */

export const PHOTO = Object.freeze({
  MAX_SIDE: 1024,
  QUALITY: 0.6,
  RETRY_QUALITY: 0.4,
  TARGET_BYTES: 150 * 1024,
  HARD_BYTES: 200 * 1024, // the same cap the server enforces (src/lib/image.js)
});

/** The size to draw at: the long side is at most `maxSide`; a small picture is never made bigger. */
export function fitWithin(width, height, maxSide = PHOTO.MAX_SIDE) {
  if (!(width > 0) || !(height > 0)) throw new Error('photo_unreadable');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** True for the bytes of a JPEG (start marker FF D8 FF, end marker FF D9). */
export function isJpegBytes(bytes) {
  return Boolean(bytes) && bytes.length >= 125 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

const CHUNK = 0x8000;
/** Bytes to base64 without building one huge argument list (which would fail on a phone for a big picture). */
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/**
 * Encodes at the normal quality; if that is over the target, tries ONE lower quality; if that is still over, gives up.
 * Never more than two encodes, so a slow phone is not kept busy.
 * @param {(quality: number) => Promise<Uint8Array>} encode
 * @returns {Promise<{ bytes: Uint8Array, quality: number, attempts: number }>}
 * @throws {Error} `photo_too_big`
 */
export async function shrinkToTarget(encode, { quality = PHOTO.QUALITY, retryQuality = PHOTO.RETRY_QUALITY, targetBytes = PHOTO.TARGET_BYTES } = {}) {
  let bytes = await encode(quality);
  if (bytes.length <= targetBytes) return { bytes, quality, attempts: 1 };
  bytes = await encode(retryQuality);
  if (bytes.length <= targetBytes) return { bytes, quality: retryQuality, attempts: 2 };
  throw new Error('photo_too_big');
}

// ---- Browser part ---------------------------------------------------------------------------------------------------

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('photo_unreadable'));
    reader.readAsDataURL(file);
  });
}

/** Decodes the picture the way the camera meant it to be seen (rotation applied). `data:` is allowed by the page's CSP; `blob:` is not. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // fall through to the <img> route
      }
    }
  }
  const image = new Image();
  image.src = await readAsDataUrl(file);
  await image.decode();
  return image;
}

/**
 * Turns the chosen file into a small JPEG.
 * @param {File} file
 * @returns {Promise<{ base64: string, bytes: number, width: number, height: number, dataUrl: string }>}
 * @throws {Error} `photo_not_image`, `photo_unreadable` or `photo_too_big`
 */
export async function preparePhoto(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('photo_not_image');
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error('photo_unreadable');
  }
  const { width, height } = fitWithin(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; // a JPEG has no see-through parts
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.close?.();
  const encode = async (quality) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.type !== 'image/jpeg') throw new Error('photo_unreadable');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isJpegBytes(bytes)) throw new Error('photo_unreadable');
    return bytes;
  };
  try {
    const { bytes } = await shrinkToTarget(encode);
    const base64 = bytesToBase64(bytes);
    return { base64, bytes: bytes.length, width, height, dataUrl: `data:image/jpeg;base64,${base64}` };
  } finally {
    canvas.width = 0; // lets a low-memory phone free the drawing surface at once
    canvas.height = 0;
  }
}
