import { Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

describe('silent Nest Logger (silence-logger.ts setup file)', () => {
  it('prints nothing from an instance logger', () => {
    const write = vi.spyOn(process.stdout, 'write');
    const writeErr = vi.spyOn(process.stderr, 'write');

    const logger = new Logger('SomeService');
    logger.log('hello');
    logger.warn('careful');
    logger.error('boom');

    expect(write).not.toHaveBeenCalled();
    expect(writeErr).not.toHaveBeenCalled();
  });

  it('still lets a spec assert on logging by spying on the logger explicitly', () => {
    const error = vi.spyOn(Logger.prototype, 'error');

    new Logger('SomeService').error('boom');

    expect(error).toHaveBeenCalledWith('boom');
  });

  it('stays silent after a Nest testing module is compiled, which installs its own logger', async () => {
    @Injectable()
    class Noisy {
      private readonly logger = new Logger(Noisy.name);
      fail() {
        this.logger.error('boom');
      }
    }
    const writeErr = vi.spyOn(process.stderr, 'write');
    const moduleRef = await Test.createTestingModule({ providers: [Noisy] }).compile();

    moduleRef.get(Noisy).fail();

    expect(writeErr).not.toHaveBeenCalled();
  });
});
