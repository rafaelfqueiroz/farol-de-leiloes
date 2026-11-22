// A MongoDB ObjectId as it appears in a URL: 24 lowercase hexadecimal characters (as the API writes them). A BFF route that puts a
// path segment into the backend path only lets this shape through (the segment cannot be `..`, a
// slash, an encoded dot or a very long value); anything else is the same NOT_FOUND the backend
// gives an id that does not exist.
const OBJECT_ID = /^[0-9a-f]{24}$/;

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}
