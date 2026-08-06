import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PropertyRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Property-level authorisation.
 *
 * Every controller that touches property-scoped data calls through here rather
 * than filtering by `userId` inline. Two reasons this is worth centralising:
 *
 *  1. **Properties are shared.** Hunting leases are group affairs — an owner, a
 *     manager, and several hunters. "Filter by owner" is wrong from day one.
 *  2. **Stand locations are genuinely sensitive.** A leaked stand set tells
 *     someone exactly where a hunter will be sitting at first light, on which
 *     winds. An `OBSERVER` who can read the map must not be able to move
 *     someone's stand, and a `HUNTER` must not be able to remove other members.
 *     One place to get that right, one place to audit it.
 */
export const ROLE_RANK: Record<PropertyRole, number> = {
  [PropertyRole.OBSERVER]: 0,
  [PropertyRole.HUNTER]: 1,
  [PropertyRole.MANAGER]: 2,
  [PropertyRole.OWNER]: 3,
};

@Injectable()
export class PropertyAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assert the user holds at least `minimum` on the property, and return their
   * effective role.
   *
   * Deliberately raises `NotFoundException` when the user has no membership at
   * all, rather than `ForbiddenException`. A 403 on a property you cannot see
   * confirms it exists, which lets someone probe for a neighbour's property id.
   * A 404 tells them nothing.
   */
  async require(
    userId: string,
    propertyId: string,
    minimum: PropertyRole = PropertyRole.OBSERVER,
  ): Promise<PropertyRole> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        ownerId: true,
        memberships: { where: { userId }, select: { role: true } },
      },
    });

    if (!property) throw new NotFoundException('Property not found.');

    const role =
      property.ownerId === userId
        ? PropertyRole.OWNER
        : property.memberships[0]?.role;

    if (!role) throw new NotFoundException('Property not found.');

    if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
      throw new ForbiddenException(
        `This action needs ${minimum.toLowerCase()} access; you have ${role.toLowerCase()}.`,
      );
    }
    return role;
  }

  /** Every property id the user can see. Used by cross-property queries. */
  async visiblePropertyIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.property.findMany({
      where: {
        OR: [{ ownerId: userId }, { memberships: { some: { userId } } }],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async canWrite(userId: string, propertyId: string): Promise<boolean> {
    try {
      await this.require(userId, propertyId, PropertyRole.HUNTER);
      return true;
    } catch {
      return false;
    }
  }
}
