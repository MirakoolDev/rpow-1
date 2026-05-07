import { describe, it, expect } from 'vitest';
import { trailingZeroBits, hasEnoughTrailingZeros } from './difficulty.js';

describe('trailingZeroBits', () => {
  it('counts zero across all-zero bytes', () => {
    expect(trailingZeroBits(new Uint8Array([0]))).toBe(8);
  });
  it('returns 0 when last byte ends in 1 bit', () => {
    expect(trailingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(trailingZeroBits(new Uint8Array([0x01]))).toBe(0);
  });
  it('counts trailing zero bits inside a single byte', () => {
    // 0xf0 = 1111_0000 → 4 trailing zeros
    expect(trailingZeroBits(new Uint8Array([0xf0]))).toBe(4);
  });
  it('counts across multiple zero bytes', () => {
    // last byte 0x00, prev 0x10 (00010000) → 8 + 4 = 12
    expect(trailingZeroBits(new Uint8Array([0x10, 0x00]))).toBe(12);
  });
  it('caps at total bit length', () => {
    expect(trailingZeroBits(new Uint8Array([0, 0, 0]))).toBe(24);
  });
});

describe('hasEnoughTrailingZeros', () => {
  it('returns true at threshold', () => {
    expect(hasEnoughTrailingZeros(new Uint8Array([0xf0]), 4)).toBe(true);
  });
  it('returns false below threshold', () => {
    expect(hasEnoughTrailingZeros(new Uint8Array([0xf0]), 5)).toBe(false);
  });
});
