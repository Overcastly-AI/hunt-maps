import { afterEach, describe, expect, it } from 'vitest';
import { tokenStore, type StoredAuth } from './tokenStore';

const SAMPLE: StoredAuth = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: 1234,
  user: { id: 'u1', email: 'a@b.com', displayName: 'Scout', unitSystem: 'IMPERIAL', createdAt: '2026-01-01' },
};

describe('tokenStore', () => {
  afterEach(() => {
    tokenStore.clear();
  });

  it('round-trips through set/get', () => {
    tokenStore.set(SAMPLE);
    expect(tokenStore.get()).toEqual(SAMPLE);
  });

  it('returns null when nothing is stored', () => {
    expect(tokenStore.get()).toBeNull();
  });

  it('clear() removes the stored value', () => {
    tokenStore.set(SAMPLE);
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it('survives a reload — persisted in localStorage, not memory', () => {
    tokenStore.set(SAMPLE);
    // Simulate a reload: read directly from localStorage rather than through
    // the module's own get(), so an in-memory-only implementation would fail
    // this even though `get()` above already "passed".
    const raw = window.localStorage.getItem('ridgeline.auth.v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(SAMPLE);
  });

  it('a corrupted entry is treated as signed out, not thrown', () => {
    window.localStorage.setItem('ridgeline.auth.v1', '{not json');
    expect(tokenStore.get()).toBeNull();
  });

  it('a well-formed but incomplete value is rejected rather than trusted', () => {
    window.localStorage.setItem('ridgeline.auth.v1', JSON.stringify({ accessToken: 'a' }));
    expect(tokenStore.get()).toBeNull();
  });
});
