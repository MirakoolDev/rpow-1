export function trailingZeroBits(buf: Uint8Array): number {
  let count = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const b = buf[i]!;
    if (b === 0) { count += 8; continue; }
    let bit = 0;
    while ((b & (1 << bit)) === 0) bit++;
    return count + bit;
  }
  return count;
}

export function hasEnoughTrailingZeros(buf: Uint8Array, target: number): boolean {
  return trailingZeroBits(buf) >= target;
}

export function bytesFromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd hex length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

/** u64 little-endian from a JS number (for solution_nonce up to 2^53). */
export function u64leFromNumber(n: number): Uint8Array {
  const out = new Uint8Array(8);
  let x = BigInt(n);
  for (let i = 0; i < 8; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
