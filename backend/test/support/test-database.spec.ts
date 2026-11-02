import { join } from 'path';
import { testDatabaseName } from './test-database';

const BACKEND_ROOT = join(__dirname, '..', '..');

describe('testDatabaseName (TS-05)', () => {
  it('derives a readable name from the spec path, without the test/ prefix and extension', () => {
    const path = join(BACKEND_ROOT, 'test', 'integration', 'job-execution.service.spec.ts');

    expect(testDatabaseName(path, 'abcd1234')).toBe('t_integration_job-execution_service_abcd1234');
  });

  it('stays within 63 bytes and the characters MongoDB allows, however long the path', () => {
    const path = join(
      BACKEND_ROOT,
      'test',
      'isolation',
      `${'Very.Long $Name '.repeat(10)}.spec.ts`,
    );
    const name = testDatabaseName(path, 'abcd1234');

    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9_-]+$/);
    expect(name.endsWith('_abcd1234')).toBe(true);
  });
});
