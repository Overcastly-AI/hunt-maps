import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy, requireJwtSecret } from './jwt.strategy';
import { PropertyAccessService } from './property-access.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ secret: requireJwtSecret() }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PropertyAccessService],
  exports: [AuthService, PropertyAccessService, JwtModule],
})
export class AuthModule {}
