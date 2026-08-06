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
    // `registerAsync`, not `register`. The synchronous form evaluates its
    // options object when the decorator runs — i.e. at *import* time — so a
    // missing JWT_SECRET would throw the moment anything transitively imported
    // this module, including a unit test for an unrelated pure function. The
    // factory defers the check to DI instantiation, which is where a
    // configuration failure belongs: still fail-fast at boot, without making
    // the secret a precondition for importing a file.
    JwtModule.registerAsync({ useFactory: () => ({ secret: requireJwtSecret() }) }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PropertyAccessService],
  exports: [AuthService, PropertyAccessService, JwtModule],
})
export class AuthModule {}
