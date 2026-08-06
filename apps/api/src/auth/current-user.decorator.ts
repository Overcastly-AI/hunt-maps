import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthedUser {
  id: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser =>
    ctx.switchToHttp().getRequest().user as AuthedUser,
);
