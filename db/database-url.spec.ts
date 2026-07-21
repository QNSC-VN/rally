import { describe, it, expect } from 'vitest';
import { resolveDatabaseUrl, resolveMigrationUrl } from './database-url';

const parts = {
  DATABASE_HOST: 'db.internal',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'rally',
  DATABASE_USER: 'app_admin',
  DATABASE_PASSWORD: 'plainpw',
};

describe('resolveDatabaseUrl', () => {
  it('returns a complete DATABASE_URL untouched', () => {
    const url = 'postgresql://u:p@h:5432/d?sslmode=require';
    expect(resolveDatabaseUrl({ DATABASE_URL: url, ...parts })).toBe(url);
  });

  it('composes from parts when no URL is supplied', () => {
    expect(resolveDatabaseUrl(parts)).toBe(
      'postgresql://app_admin:plainpw@db.internal:5432/rally?sslmode=require',
    );
  });

  it('accepts a numeric port', () => {
    expect(resolveDatabaseUrl({ ...parts, DATABASE_PORT: 5432 })).toContain(':5432/rally');
  });

  it('honours an explicit sslmode', () => {
    expect(resolveDatabaseUrl({ ...parts, DATABASE_SSLMODE: 'disable' })).toMatch(
      /sslmode=disable$/,
    );
  });

  // AWS-generated passwords routinely contain URL-structural characters. Left
  // raw, these either fail to parse or — worse — parse into a DIFFERENT host,
  // which is a silent connection to somewhere unintended.
  it.each([
    ['p@ss', 'p%40ss'],
    ['a/b', 'a%2Fb'],
    ['a:b', 'a%3Ab'],
    ['a?b', 'a%3Fb'],
    ['a#b', 'a%23ss'.replace('ss', 'b')],
  ])('percent-encodes %s in the password', (raw, encoded) => {
    const url = resolveDatabaseUrl({ ...parts, DATABASE_PASSWORD: raw });
    expect(url).toContain(`:${encoded}@`);
  });

  it('a password containing @ still parses to the real host', () => {
    const url = resolveDatabaseUrl({ ...parts, DATABASE_PASSWORD: 'pa@ss/word' });
    expect(new URL(url).hostname).toBe('db.internal');
  });

  it('encodes the username too', () => {
    expect(resolveDatabaseUrl({ ...parts, DATABASE_USER: 'a@b' })).toContain('a%40b:');
  });

  it.each([
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
  ])('throws naming %s when it is missing', (key) => {
    const incomplete = { ...parts, [key]: undefined };
    expect(() => resolveDatabaseUrl(incomplete)).toThrow(key);
  });

  it('throws rather than emitting a URL with undefined segments', () => {
    expect(() => resolveDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});

describe('resolveMigrationUrl', () => {
  it('prefers DATABASE_MIGRATION_URL', () => {
    const mig = 'postgresql://admin:p@h:5432/d';
    expect(
      resolveMigrationUrl({ DATABASE_MIGRATION_URL: mig, DATABASE_URL: 'postgresql://a:b@c/d' }),
    ).toBe(mig);
  });

  it('falls back to the app URL', () => {
    const app = 'postgresql://a:b@c:5432/d';
    expect(resolveMigrationUrl({ DATABASE_URL: app })).toBe(app);
  });

  it('falls back to composing from parts', () => {
    expect(resolveMigrationUrl(parts)).toContain('app_admin');
  });
});
