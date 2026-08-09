import type { ArgumentsHost } from '@nestjs/common';
import { Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { isInsufficientHaloError } from '@hunt-maps/terrain';
import type { Response } from 'express';

/**
 * Turns the engine's `InsufficientHaloError` into a client-actionable 422
 * instead of an unhandled 500.
 *
 * `analyze()` (and, as of `R41`, `DemService.gridForBBox`) throws this when a
 * request's neighbourhood operator — shelter, sky-view, the bedding cover
 * term — needs a deeper halo than a one-tile fetch ring can supply. That is a
 * *normal, recoverable* condition: "zoom out", "fetch a wider area", "drop
 * this layer at this zoom" are all real answers a client can act on. It is
 * not a server fault, and CLAUDE.md's rule applies directly — "say when you
 * do not know", grey the layer out, do not crash the request and hand the
 * caller a stack trace.
 *
 * Registered once in `main.ts` (not via `APP_FILTER`, so it can be
 * constructed with the `httpAdapter` `BaseExceptionFilter` needs — see the
 * Nest "catch everything" recipe). Everything that is not this error falls
 * straight through to Nest's normal handling, unchanged.
 */
@Catch()
export class InsufficientHaloFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!isInsufficientHaloError(exception)) {
      super.catch(exception, host);
      return;
    }

    const res = host.switchToHttp().getResponse<Response>();
    res.status(422).json({
      statusCode: 422,
      error: 'INSUFFICIENT_HALO',
      message: exception.message,
      // Cell counts, not a prose-only message, so a client can decide *how
      // much* to zoom out rather than just that it needs to.
      requiredHaloCells: exception.required,
      availableHaloCells: exception.available,
      layers: exception.layers,
    });
  }
}
