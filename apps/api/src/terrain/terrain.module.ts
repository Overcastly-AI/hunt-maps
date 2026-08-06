import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemService } from './dem.service';
import { TerrainService } from './terrain.service';
import { CorridorService } from './corridor.service';
import { TerrainController } from './terrain.controller';

@Module({
  imports: [AuthModule],
  controllers: [TerrainController],
  providers: [DemService, TerrainService, CorridorService],
  exports: [DemService, TerrainService, CorridorService],
})
export class TerrainModule {}
