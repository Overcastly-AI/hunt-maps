import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { GeometryService } from './geometry.service';

@Global()
@Module({
  providers: [PrismaService, GeometryService],
  exports: [PrismaService, GeometryService],
})
export class PrismaModule {}
