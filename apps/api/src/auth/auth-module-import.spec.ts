import { describe, expect, it } from 'vitest';

describe('AuthModule import safety', () => {
  it('can be imported without JWT_SECRET set', async () => {
    // Regression guard. `JwtModule.register({ secret: requireJwtSecret() })`
    // evaluates its options when the decorator runs, so a missing secret threw
    // at *import* time — which meant a unit test for an unrelated pure function
    // failed simply because its module graph reached AuthModule.
    // `registerAsync` defers the check to DI instantiation: still fail-fast at
    // boot, without making the secret a precondition for importing a file.
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const mod = await import('./auth.module');
      expect(mod.AuthModule).toBeDefined();
    } finally {
      if (saved !== undefined) process.env.JWT_SECRET = saved;
    }
  });

  it('still rejects a weak or absent secret when actually asked for one', async () => {
    const { requireJwtSecret } = await import('./jwt.strategy');
    const saved = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      expect(() => requireJwtSecret()).toThrow(/JWT_SECRET/);

      process.env.JWT_SECRET = 'too-short';
      expect(() => requireJwtSecret()).toThrow(/at least 32/);

      process.env.JWT_SECRET = 'x'.repeat(48);
      expect(requireJwtSecret()).toHaveLength(48);
    } finally {
      if (saved === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = saved;
    }
  });
});
