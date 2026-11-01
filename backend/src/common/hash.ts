import * as crypto from 'crypto';

export function createStableId(obj: unknown): string {
  const s = JSON.stringify(obj, replacer);
  return crypto.createHash('sha1').update(s).digest('hex');
}

function replacer(_key: string, value: any) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = value[k];
        return acc;
      }, {});
  }
  return value;
}
