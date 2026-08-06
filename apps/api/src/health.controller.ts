import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<{ status: string; postgis: string | null }> {
    // Report the PostGIS version specifically, not just "db reachable". Every
    // spatial query in this service fails in a confusing way if the extension
    // is missing, and this is the fastest place to find that out.
    let postgis: string | null = null;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ v: string }>>`
        SELECT postgis_version() AS v
      `;
      postgis = rows[0]?.v ?? null;
    } catch {
      postgis = null;
    }
    return { status: postgis ? 'ok' : 'degraded', postgis };
  }
}
