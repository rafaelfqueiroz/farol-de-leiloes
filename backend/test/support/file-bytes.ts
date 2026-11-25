// Small, fake file bodies whose first bytes are the real signatures (SC-13): enough to pass the
// type check, never a real photo or document.
export const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('jpeg-one'),
]);
export const PDF_BYTES = Buffer.from('%PDF-1.7\nsynthetic document one\n');

/** Another body of the same type: a different hash, so a different version. */
export function pdfVariant(label: string): Buffer {
  return Buffer.from(`%PDF-1.7\nsynthetic document ${label}\n`);
}

export function jpegVariant(label: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg-${label}`)]);
}
