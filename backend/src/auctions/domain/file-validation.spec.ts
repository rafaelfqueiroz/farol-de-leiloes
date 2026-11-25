import { describe, expect, it } from 'vitest';
import { sniffType, validateCaixaFile } from './file-validation.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('rest')]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const HTML = Buffer.from('<html><body>challenge</body></html>');
const LIMITS = { maxPhotoBytes: 100, maxDocumentBytes: 1000 };

describe('sniffType', () => {
  it('recognises the four types by their first bytes', () => {
    expect(sniffType(JPEG)).toBe('image/jpeg');
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(WEBP)).toBe('image/webp');
    expect(sniffType(PDF)).toBe('application/pdf');
  });

  it('recognises nothing else, and nothing too short to tell', () => {
    expect(sniffType(HTML)).toBeNull();
    expect(sniffType(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffType(Buffer.from('89504e47', 'hex'))).toBeNull();
    expect(sniffType(Buffer.from('RIFF....WAVE'))).toBeNull();
    expect(sniffType(Buffer.from('RIFF....WEB'))).toBeNull();
    expect(sniffType(Buffer.from('%PDF'))).toBeNull();
    expect(sniffType(Buffer.alloc(0))).toBeNull();
  });
});

describe('validateCaixaFile (BR-004-22, SC-13)', () => {
  it('accepts a photo whose bytes and header agree, with the extension of its type', () => {
    expect(validateCaixaFile('PHOTO', { body: JPEG, contentType: 'image/jpeg' }, LIMITS)).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      extension: 'jpg',
      size: JPEG.length,
    });
    expect(
      validateCaixaFile('PHOTO', { body: PNG, contentType: 'image/png' }, LIMITS),
    ).toMatchObject({
      ok: true,
      extension: 'png',
    });
    expect(
      validateCaixaFile('PHOTO', { body: WEBP, contentType: 'image/webp; q=1' }, LIMITS),
    ).toMatchObject({ ok: true, extension: 'webp' });
  });

  it('accepts a PDF as an edital or a matrícula', () => {
    for (const kind of ['EDITAL', 'MATRICULA'] as const) {
      expect(
        validateCaixaFile(kind, { body: PDF, contentType: 'application/pdf' }, LIMITS),
      ).toMatchObject({ ok: true, contentType: 'application/pdf', extension: 'pdf' });
    }
  });

  it('reads image/jpg as image/jpeg and a missing or generic header as "the bytes decide"', () => {
    for (const contentType of ['image/jpg', 'IMAGE/JPEG', null, '', 'application/octet-stream']) {
      expect(validateCaixaFile('PHOTO', { body: JPEG, contentType }, LIMITS).ok).toBe(true);
    }
  });

  it('refuses an empty body', () => {
    expect(
      validateCaixaFile('PHOTO', { body: Buffer.alloc(0), contentType: 'image/jpeg' }, LIMITS),
    ).toEqual({
      ok: false,
      reason: 'EMPTY',
    });
  });

  it('refuses a photo over the photo cap and a document over the document cap, not before', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(101 - JPEG.length)]);
    expect(validateCaixaFile('PHOTO', { body: big, contentType: 'image/jpeg' }, LIMITS)).toEqual({
      ok: false,
      reason: 'TOO_LARGE',
    });
    const atCap = Buffer.concat([JPEG, Buffer.alloc(100 - JPEG.length)]);
    expect(validateCaixaFile('PHOTO', { body: atCap, contentType: 'image/jpeg' }, LIMITS).ok).toBe(
      true,
    );
    const bigPdf = Buffer.concat([PDF, Buffer.alloc(1001 - PDF.length)]);
    expect(
      validateCaixaFile('EDITAL', { body: bigPdf, contentType: 'application/pdf' }, LIMITS),
    ).toEqual({
      ok: false,
      reason: 'TOO_LARGE',
    });
    // A document may be larger than a photo is allowed to be.
    const pdf500 = Buffer.concat([PDF, Buffer.alloc(500 - PDF.length)]);
    expect(
      validateCaixaFile('MATRICULA', { body: pdf500, contentType: 'application/pdf' }, LIMITS).ok,
    ).toBe(true);
  });

  it('refuses bytes that are no allowed type, whatever the header claims', () => {
    expect(validateCaixaFile('PHOTO', { body: HTML, contentType: 'image/jpeg' }, LIMITS)).toEqual({
      ok: false,
      reason: 'WRONG_TYPE',
    });
    expect(
      validateCaixaFile('EDITAL', { body: HTML, contentType: 'application/pdf' }, LIMITS),
    ).toEqual({
      ok: false,
      reason: 'WRONG_TYPE',
    });
  });

  it('refuses a type that is allowed for another kind: a PDF as a photo, a photo as an edital', () => {
    expect(
      validateCaixaFile('PHOTO', { body: PDF, contentType: 'application/pdf' }, LIMITS),
    ).toEqual({
      ok: false,
      reason: 'WRONG_TYPE',
    });
    expect(validateCaixaFile('EDITAL', { body: JPEG, contentType: 'image/jpeg' }, LIMITS)).toEqual({
      ok: false,
      reason: 'WRONG_TYPE',
    });
    expect(validateCaixaFile('MATRICULA', { body: PNG, contentType: null }, LIMITS)).toEqual({
      ok: false,
      reason: 'WRONG_TYPE',
    });
  });

  it('refuses a header that names another allowed type than the bytes show', () => {
    expect(validateCaixaFile('PHOTO', { body: JPEG, contentType: 'image/png' }, LIMITS)).toEqual({
      ok: false,
      reason: 'TYPE_MISMATCH',
    });
    expect(validateCaixaFile('EDITAL', { body: PDF, contentType: 'image/jpeg' }, LIMITS)).toEqual({
      ok: false,
      reason: 'TYPE_MISMATCH',
    });
  });

  it('refuses a header that names a type that is never kept, such as SVG, GIF or HTML', () => {
    for (const contentType of ['image/svg+xml', 'image/gif', 'text/html; charset=utf-8']) {
      expect(validateCaixaFile('PHOTO', { body: JPEG, contentType }, LIMITS)).toEqual({
        ok: false,
        reason: 'WRONG_TYPE',
      });
    }
  });
});
