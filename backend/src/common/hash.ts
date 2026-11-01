import * as crypto from 'crypto';

export function createStableId(obj: unknown): string {
  const s = JSON.stringify(obj, replacer);
  return crypto.createHash('sha1').update(s).digest('hex');
}

// Sorts object keys so equal objects hash equally whatever their key order.
function replacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = new Map(Object.entries(value));
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = entries.get(k);
        return acc;
      }, {});
  }
  return value;
}
