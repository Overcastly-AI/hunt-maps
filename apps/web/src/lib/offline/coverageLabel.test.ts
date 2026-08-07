import { describe, expect, it } from 'vitest';
import { describeCoverage, percentLabel } from './coverageLabel';
import type { CoverageResult, CoverageState } from './coverage';

function result(over: Partial<CoverageResult> = {}): CoverageState {
  return {
    kind: 'result',
    result: {
      status: 'covered',
      basis: 'view',
      viewZoom: 14,
      tileZoom: 14,
      neededTiles: 20,
      probedTiles: 20,
      presentTiles: 20,
      fraction: 1,
      sampled: false,
      coveredExtent: [],
      backend: 'opfs',
      volatile: false,
      ...over,
    },
  };
}

/**
 * The wording is the product here. The defect these guard against is not a
 * crash — it is a sentence that sounds reassuring and is not true, which is
 * exactly what shipped before.
 */
describe('the indeterminate states', () => {
  it('says it is checking, and never anything reassuring', () => {
    for (const state of [null, { kind: 'checking' } as const]) {
      const d = describeCoverage(state);
      expect(d.chip).toBe('Checking…');
      expect(d.tone).toBe('neutral');
      expect(d.chip.toLowerCase()).not.toContain('covered');
      expect(d.chip.toLowerCase()).not.toContain('ready');
    }
  });

  it('an unreadable store is its own state, not "not downloaded"', () => {
    const d = describeCoverage({ kind: 'unavailable', reason: 'OPFS blocked' });
    expect(d.tone).toBe('danger');
    expect(d.chip).not.toBe('Not downloaded');
    expect(d.detail).toContain('OPFS blocked');
    // It must still tell the user what to assume, rather than leaving them to
    // guess in the optimistic direction.
    expect(d.detail).toContain('not downloaded');
  });

  it('no state produces the word "ready" — the old badge is gone for good', () => {
    const states: Array<CoverageState | null> = [
      null,
      { kind: 'checking' },
      { kind: 'unavailable', reason: 'x' },
      result(),
      result({ status: 'partial', fraction: 0.4, presentTiles: 8 }),
      result({ status: 'empty', fraction: 0, presentTiles: 0 }),
    ];
    for (const s of states) {
      expect(describeCoverage(s).chip.toLowerCase()).not.toContain('ready');
    }
  });
});

describe('the three measured answers', () => {
  it('covered', () => {
    const d = describeCoverage(result());
    expect(d.chip).toBe('Covered');
    expect(d.tone).toBe('ok');
    expect(d.detail).toContain('zoom 14');
  });

  it('partial names the percentage of *this view*', () => {
    const d = describeCoverage(
      result({ status: 'partial', fraction: 8 / 20, presentTiles: 8 }),
    );
    expect(d.chip).toBe('Partial — 40%');
    expect(d.tone).toBe('warn');
    expect(d.detail).toContain('this view');
  });

  it('not downloaded', () => {
    const d = describeCoverage(result({ status: 'empty', fraction: 0, presentTiles: 0 }));
    expect(d.chip).toBe('Not downloaded');
    expect(d.tone).toBe('warn');
  });

  it('marks a sampled figure as approximate and says how it was sampled', () => {
    const d = describeCoverage(
      result({
        status: 'partial',
        fraction: 0.42,
        sampled: true,
        probedTiles: 48,
        neededTiles: 12_400,
        presentTiles: 20,
      }),
    );
    expect(d.chip).toContain('≈');
    expect(d.detail).toContain('48-tile sample');
    expect(d.detail).toContain('12,400');
  });

  it('warns when the view is covered but the deeper zoom is not', () => {
    const d = describeCoverage(
      result({
        status: 'partial',
        basis: 'detail',
        viewZoom: 12,
        tileZoom: 15,
        fraction: 0.25,
        sampled: true,
      }),
    );
    expect(d.tone).toBe('warn');
    expect(d.detail).toContain('zoom 12');
    expect(d.detail).toContain('15');
    expect(d.detail).toContain('zoom in');
  });

  it('says out loud when coverage will not survive a reload', () => {
    const d = describeCoverage(result({ volatile: true }));
    expect(d.chip).toBe('Covered');
    expect(d.detail).toContain('memory only');
  });
});

describe('percentLabel', () => {
  it('never rounds a partial view up to 100 or down to 0', () => {
    // 99.6% covered still has a blank square in it; 0.2% still has ground that
    // works. Only the `covered` and `empty` verdicts may say all or nothing.
    expect(percentLabel(0.996)).toBe(99);
    expect(percentLabel(0.002)).toBe(1);
  });

  it('rounds normally in between', () => {
    expect(percentLabel(0.4)).toBe(40);
    expect(percentLabel(0.567)).toBe(57);
  });
});
