import { describe, expect, it } from 'vitest';
import { GameSpecies, RutPhase } from '@hunt-maps/shared';
import { formatRut } from './propertyFormat';

describe('formatRut', () => {
  it('returns null when the property has no rut reading at all', () => {
    expect(formatRut(null)).toBeNull();
  });

  it('formats a supported reading with a bucketed confidence, never the bare number', () => {
    const formatted = formatRut({
      supported: true,
      phase: RutPhase.Chasing,
      daysFromPeak: -6,
      confidence: 0.9,
      note: 'Sit all day near doe bedding.',
    });
    expect(formatted).toEqual({
      supported: true,
      phase: 'Chasing',
      note: 'Sit all day near doe bedding.',
      confidence: { label: 'High confidence', tone: 'ok' },
    });
  });

  /**
   * R83's actual regression target (`docs/EVIDENCE.md` Pass 7): the model was
   * confidently wrong for elk, not merely silent, so the refusal must never
   * degrade into a phase label. `RutUnsupported` carries no `phase` field on
   * the wire — this pins that `formatRut` does not fabricate one either.
   */
  it('formats an unsupported (refused) reading with no phase, ever', () => {
    const formatted = formatRut({
      supported: false,
      species: GameSpecies.Elk,
      reason:
        'No rut model for elk — this photoperiod curve is fitted to whitetail breeding data only (docs/EVIDENCE.md Pass 7).',
    });
    expect(formatted).toEqual({
      supported: false,
      headline: 'No rut model for elk',
      reason:
        'No rut model for elk — this photoperiod curve is fitted to whitetail breeding data only (docs/EVIDENCE.md Pass 7).',
    });
    // The type itself carries this — `FormattedRutUnsupported` has no `phase`
    // field to check — but assert the rendered object literally has none too,
    // in case a future edit widens the type and reintroduces one by accident.
    expect(formatted).not.toHaveProperty('phase');
    expect(formatted).not.toHaveProperty('confidence');
  });

  it('names every other non-whitetail species correctly in the refusal headline', () => {
    const cases: Array<[GameSpecies, string]> = [
      [GameSpecies.Mule, 'No rut model for mule deer'],
      [GameSpecies.Moose, 'No rut model for moose'],
      [GameSpecies.Blacktail, 'No rut model for blacktail'],
      [GameSpecies.Pronghorn, 'No rut model for pronghorn'],
      [GameSpecies.Bear, 'No rut model for bear'],
      [GameSpecies.Turkey, 'No rut model for turkey'],
      [GameSpecies.Hog, 'No rut model for hog'],
    ];
    for (const [species, headline] of cases) {
      const formatted = formatRut({
        supported: false,
        species,
        reason: 'irrelevant to this assertion',
      });
      expect(formatted?.supported).toBe(false);
      if (formatted && !formatted.supported) {
        expect(formatted.headline).toBe(headline);
      }
    }
  });
});
