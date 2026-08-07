import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { InsufficientHaloError } from '@hunt-maps/terrain';
import { InsufficientHaloFilter } from './insufficient-halo.filter';

function fakeHost(res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }) {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

function fakeResponse() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

describe('InsufficientHaloFilter', () => {
  it('turns InsufficientHaloError into an actionable 422, not a 500 with a stack trace', () => {
    const filter = new InsufficientHaloFilter();
    const res = fakeResponse();
    const err = new InsufficientHaloError({
      required: 273,
      available: 256,
      layers: ['shelter'],
    });

    filter.catch(err, fakeHost(res));

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.status.mock.results[0].value.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        error: 'INSUFFICIENT_HALO',
        requiredHaloCells: 273,
        availableHaloCells: 256,
        layers: ['shelter'],
      }),
    );
  });

  it('delegates every other error to Nest default handling rather than swallowing it', () => {
    const filter = new InsufficientHaloFilter();
    const delegate = vi
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
    const err = new Error('DEM source returned 500');
    const host = fakeHost(fakeResponse());

    filter.catch(err, host);

    expect(delegate).toHaveBeenCalledWith(err, host);
    delegate.mockRestore();
  });
});
