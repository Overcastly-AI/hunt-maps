import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 90;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthTokens> {
    const normalised = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalised } });
    if (existing) throw new ConflictException('An account with that email already exists.');

    const user = await this.prisma.user.create({
      data: {
        email: normalised,
        passwordHash: await bcrypt.hash(password, 12),
        displayName: displayName.trim(),
      },
    });
    return this.issueTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    // Compare against a dummy hash when the user is absent so a missing account
    // and a wrong password take the same time. Without this, response timing
    // enumerates which email addresses are registered.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password.');

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Exchange a refresh token for a new pair, rotating the old one.
   *
   * Rotation matters more than usual here: this app is used offline for long
   * stretches and refresh tokens live for 90 days, so a leaked one is valuable.
   * The presented token is revoked as soon as it is spent, which means a
   * replayed token is both rejected and detectable.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.user.id, record.user.email);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email } satisfies JwtPayload,
      { expiresIn: ACCESS_TTL_SECONDS },
    );

    // Opaque, high-entropy refresh token. Stored hashed so a database dump does
    // not hand over live sessions.
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
      },
    });

    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_SECONDS };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A real bcrypt hash of a value nobody can present, for constant-time login. */
const DUMMY_HASH = '$2a$12$K3JNi5nHXQ7uJm3M8vQ1cO5bKq5R9y1ZQ0J8YkPq2sV6xW3nT7aBu';
