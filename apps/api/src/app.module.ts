import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PropertiesModule } from './properties/properties.module';
import { WaypointsModule } from './waypoints/waypoints.module';
import { ObservationsModule } from './observations/observations.module';
import { TerrainModule } from './terrain/terrain.module';
import { FiltersModule } from './filters/filters.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { OfflineModule } from './offline/offline.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    PropertiesModule,
    WaypointsModule,
    ObservationsModule,
    TerrainModule,
    FiltersModule,
    AnalyticsModule,
    OfflineModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
