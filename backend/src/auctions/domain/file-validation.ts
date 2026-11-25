// SPEC-004 BR-004-22, SC-13 (as for uploads, applied to the copies of Caixa's files): a file is
// kept only if its type is on the allowlist for what it is, its BYTES say the same type (the
// header Caixa sent is never trusted alone), and it is within the size cap. Pure (AR-05).

/** What a copy is: a gallery photo, the sale notice, the property's registry record. */
export type CopyKind = 'PHOTO' | 'EDITAL' | 'MATRICULA';

export type AllowedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const EXTENSION: Readonly<Record<AllowedType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const ALLOWED_FOR: Readonly<Record<CopyKind, readonly AllowedType[]>> = {
  PHOTO: ['image/jpeg', 'image/png', 'image/webp'],
  EDITAL: ['application/pdf'],
  MATRICULA: ['application/pdf'],
};

export type FileRejection = 'EMPTY' | 'TOO_LARGE' | 'WRONG_TYPE' | 'TYPE_MISMATCH';

export interface FileLimits {
  maxPhotoBytes: number;
  maxDocumentBytes: number;
}

export interface CaixaFileInput {
  body: Buffer;
  /** The Content-Type header Caixa sent; null when it sent none. */
  contentType: string | null;
}

export type FileVerdict =
  | { ok: true; contentType: AllowedType; extension: string; size: number }
  | { ok: false; reason: FileRejection };

/** The type the first bytes show, or null: JPEG, PNG, WebP (RIFF....WEBP) and PDF (`%PDF-`). */
export function sniffType(body: Buffer): AllowedType | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'image/jpeg';
  }
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (
    body.length >= 12 &&
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (body.length >= 5 && body.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

const UNSPECIFIC = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

/** The header's media type, lower-case, without parameters; `image/jpg` is `image/jpeg`. */
function declaredType(header: string | null): string {
  const media = (header ?? '').replace(/;.*$/s, '').trim().toLowerCase();
  return media === 'image/jpg' ? 'image/jpeg' : media;
}

/**
 * Whether `file` may be kept as a copy of kind `kind`. The decision is made on the bytes; a header
 * that names another type (or one off the allowlist, like HTML or SVG) refuses the file, while a
 * missing or generic one (`application/octet-stream`) is left to the bytes.
 */
export function validateCaixaFile(
  kind: CopyKind,
  file: CaixaFileInput,
  limits: FileLimits,
): FileVerdict {
  if (file.body.length === 0) return { ok: false, reason: 'EMPTY' };
  const cap = kind === 'PHOTO' ? limits.maxPhotoBytes : limits.maxDocumentBytes;
  if (file.body.length > cap) return { ok: false, reason: 'TOO_LARGE' };

  const sniffed = sniffType(file.body);
  if (sniffed === null || !ALLOWED_FOR[kind].includes(sniffed)) {
    return { ok: false, reason: 'WRONG_TYPE' };
  }
  const declared = declaredType(file.contentType);
  if (!UNSPECIFIC.has(declared) && declared !== sniffed) {
    // A header that names a type we never keep is the wrong type; one that names another allowed
    // type contradicts the bytes.
    const known = (Object.keys(EXTENSION) as AllowedType[]).includes(declared as AllowedType);
    return { ok: false, reason: known ? 'TYPE_MISMATCH' : 'WRONG_TYPE' };
  }
  return { ok: true, contentType: sniffed, extension: EXTENSION[sniffed], size: file.body.length };
}
