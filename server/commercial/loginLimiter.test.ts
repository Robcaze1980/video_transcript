import { expect, it } from 'vitest';
import { PeerLoginLimiter } from './loginLimiter';

it('isolates peers, normalizes mapped IPv4 and resets at the fixed deadline', () => {
  let time = 0;
  const limiter = new PeerLoginLimiter(2, 60_000, 10, () => time);
  expect(limiter.take('::ffff:192.0.2.1')).toBe(true);
  expect(limiter.take('192.0.2.1')).toBe(true);
  expect(limiter.take('192.0.2.1')).toBe(false);
  expect(limiter.take('192.0.2.2')).toBe(true);
  time = 59_999;
  expect(limiter.take('192.0.2.1')).toBe(false);
  time = 60_000;
  expect(limiter.take('192.0.2.1')).toBe(true);
});

it('bounds peer memory without evicting a live or blocked bucket', () => {
  let time = 0;
  const limiter = new PeerLoginLimiter(1, 100, 2, () => time);
  expect(limiter.take('a')).toBe(true);
  time = 50;
  expect(limiter.take('b')).toBe(true);
  expect(limiter.take('c')).toBe(false);
  expect(limiter.take('a')).toBe(false);
  time = 100;
  expect(limiter.take('c')).toBe(true);
  expect(limiter.take('b')).toBe(false);
  time = 150;
  expect(limiter.take('b')).toBe(true);
});

it('counts only recorded invitation failures and uses a shared unknown-peer bucket', () => {
  const limiter = new PeerLoginLimiter(2);
  for (let i = 0; i < 20; i++) expect(limiter.isBlocked('a')).toBe(false);
  limiter.recordFailure('a'); limiter.recordFailure('a');
  expect(limiter.isBlocked('a')).toBe(true);
  expect(limiter.isBlocked('b')).toBe(false);
  expect(limiter.take()).toBe(true);
  expect(limiter.take('')).toBe(true);
  expect(limiter.take()).toBe(false);
});

it('rejects invalid limiter settings', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    expect(() => new PeerLoginLimiter(value)).toThrow();
    expect(() => new PeerLoginLimiter(1, value)).toThrow();
    expect(() => new PeerLoginLimiter(1, 1, value)).toThrow();
  }
});
