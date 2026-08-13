import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemService } from './dem.service';
import { Dem3depService } from './dem3dep.service';
import { TerrainService } from './terrain.service';
import { CorridorService } from './corridor.service';
import { TerrainController } from './terrain.controller';

@Module({
  imports: [AuthModule],
  controllers: [TerrainController],
  providers: [DemService, Dem3depService, TerrainService, CorridorService],
  exports: [DemService, Dem3depService, TerrainService, CorridorService],
})
export class TerrainModule {}
