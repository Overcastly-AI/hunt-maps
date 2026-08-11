import { Species } from '@prisma/client';
import { GameSpecies } from '@hunt-maps/shared';

/**
 * Prisma's `Species` enum (SCREAMING_SNAKE_CASE, no runtime relation to
 * `@hunt-maps/shared`) mapped to `@hunt-maps/shared`'s `GameSpecies`, so a
 * logged observation's species or a property's `targetSpecies` can be
 * threaded into `readRut` (R83).
 *
 * Every member maps 1:1 — there is deliberately no fallback branch, so a
 * species added to one enum and not the other fails to compile instead of
 * silently defaulting.
 *
 * Shared between `ObservationsService` and `PropertiesService` rather than
 * declared twice: both need the exact same mapping, and a divergence between
 * them would be the kind of drift that reintroduces R83 by accident.
 */
export const SPECIES_TO_GAME_SPECIES: Record<Species, GameSpecies> = {
  [Species.WHITETAIL]: GameSpecies.Whitetail,
  [Species.MULE_DEER]: GameSpecies.Mule,
  [Species.BLACKTAIL]: GameSpecies.Blacktail,
  [Species.ELK]: GameSpecies.Elk,
  [Species.MOOSE]: GameSpecies.Moose,
  [Species.PRONGHORN]: GameSpecies.Pronghorn,
  [Species.BEAR]: GameSpecies.Bear,
  [Species.TURKEY]: GameSpecies.Turkey,
  [Species.HOG]: GameSpecies.Hog,
  [Species.OTHER]: GameSpecies.Other,
};
