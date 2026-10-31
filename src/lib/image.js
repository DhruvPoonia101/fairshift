/** The most a report photo may weigh once decoded. The phone shrinks to 150 KB or less; this is the hard stop on the server. */
export const MAX_PHOTO_BYTES = 200 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * True for the bytes of a JPEG: it starts with the start-of-image marker followed by another marker
 * (FF D8 FF xx) and ends with the end-of-image marker (FF D9). Looks at the bytes, never at a file name or a claimed type.
 * @param {Uint8Array} bytes
 */
export function isJpeg(bytes) {
  if (!bytes || bytes.length < 125) return false; // smaller than any real picture
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] >= 0xc0 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

/**
 * Checks a base64 string from the phone and returns the decoded bytes. Throws a short reason, never the content:
 * `type`, `too_large`, `format` (not base64) or `not_jpeg`.
 * @param {unknown} value
 * @param {number} [maxBytes]
 * @returns {Buffer}
 */
export function decodeJpegBase64(value, maxBytes = MAX_PHOTO_BYTES) {
  if (typeof value !== 'string') throw new Error('type');
  if (value.length > Math.ceil(maxBytes / 3) * 4) throw new Error('too_large'); // before decoding anything
  if (value.length % 4 !== 0 || !BASE64.test(value)) throw new Error('format');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxBytes) throw new Error('too_large');
  if (!isJpeg(bytes)) throw new Error('not_jpeg');
  return bytes;
}
