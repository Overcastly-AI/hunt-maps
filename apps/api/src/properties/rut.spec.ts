import { describe, expect, it } from 'vitest';
import { Species } from '@prisma/client';
import { GameSpecies } from '@hunt-maps/shared';
import { propertyRut } from './properties.module';

// The founder's own ground — Montana HD 320, Tobacco Root Mountains.
const MONTANA = { centerLat: 45.5, rutOffsetDays: null };

describe('propertyRut — R83, species-aware at the property level', () => {
  it('withholds the reading entirely when the property has no boundary yet (no centerLat)', () => {
    expect(
      propertyRut({ centerLat: null, targetSpecies: Species.WHITETAIL, rutOffsetDays: null }),
    ).toBeNull();
  });

  it(
    'withholds the reading when no species is stated — deliberately does NOT fall back to the ' +
      'whitetail default the way readRut() does for callers that predate species-awareness ' +
      '(see the migration comment on Property.targetSpecies)',
    () => {
      expect(propertyRut({ ...MONTANA, targetSpecies: null })).toBeNull();
    },
  );

  it('a stated WHITETAIL property gets a real reading, not a refusal', () => {
    const r = propertyRut({ ...MONTANA, targetSpecies: Species.WHITETAIL });
    expect(r).not.toBeNull();
    expect(r!.supported).toBe(true);
  });

  it(
    'a stated ELK property gets the refusal (RutUnsupported), never a whitetail-calendar phase — ' +
      'this is the actual P0: an elk property at 45.5°N must not render "OffSeason" on the day of ' +
      'peak bugling or "Lockdown" weeks after the real elk rut (docs/EVIDENCE.md Pass 7)',
    () => {
      const r = propertyRut({ ...MONTANA, targetSpecies: Species.ELK });
      expect(r).not.toBeNull();
      expect(r!.supported).toBe(false);
      if (!r!.supported) {
        expect(r!.species).toBe(GameSpecies.Elk);
        expect(r).not.toHaveProperty('phase');
        expect(r).not.toHaveProperty('daysFromPeak');
      }
    },
  );

  it('refuses for every non-whitetail species carried on a property, not just elk', () => {
    const nonWhitetail: Species[] = [
      Species.MULE_DEER,
      Species.BLACKTAIL,
      Species.MOOSE,
      Species.PRONGHORN,
      Species.BEAR,
      Species.TURKEY,
      Species.HOG,
      Species.OTHER,
    ];
    for (const targetSpecies of nonWhitetail) {
      const r = propertyRut({ ...MONTANA, targetSpecies });
      expect(r!.supported).toBe(false);
    }
  });
});
