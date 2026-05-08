import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp } from './helpers.js';

describe('GET /ledger', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => { if (cleanup) await cleanup(); cleanup = null; });

  it('public, no auth, returns counters and schedule info', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const res = await ctx.app.inject({ method: 'GET', url: '/ledger' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      total_minted: 0,
      total_transferred: 0,
      circulating_supply: 0,
      current_difficulty_bits: 8,
      user_count: 0,
      // schedule fields, computed against test fixture (epochSize=10, maxSupply=21, base=8)
      max_supply: 21,
      epoch: 0,
      epoch_size: 10,
      next_milestone_at: 10,
      coins_until_next_milestone: 10,
      next_difficulty_bits: 9,
      is_capped: false,
    });
  });

  it('reports epoch progress as supply grows', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const { randomUUID } = await import('node:crypto');
    // Seed 12 root tokens → into epoch 1 (10..19), 8 to next milestone
    for (let i = 0; i < 12; i++) {
      await ctx.pool.query(
        `INSERT INTO tokens(id, owner_email, value, state, server_sig)
         VALUES ($1, $2, 1, 'VALID', '\\x00')`,
        [randomUUID(), `seed-${i}@x.com`],
      );
    }
    const body = (await ctx.app.inject({ method: 'GET', url: '/ledger' })).json();
    expect(body.total_minted).toBe(12);
    expect(body.epoch).toBe(1);
    expect(body.current_difficulty_bits).toBe(9);
    expect(body.coins_until_next_milestone).toBe(8);
    expect(body.next_milestone_at).toBe(20);
    expect(body.is_capped).toBe(false);
  });

  it('reports is_capped at maxSupply', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const { randomUUID } = await import('node:crypto');
    for (let i = 0; i < 21; i++) {
      await ctx.pool.query(
        `INSERT INTO tokens(id, owner_email, value, state, server_sig)
         VALUES ($1, $2, 1, 'VALID', '\\x00')`,
        [randomUUID(), `seed-${i}@x.com`],
      );
    }
    const body = (await ctx.app.inject({ method: 'GET', url: '/ledger' })).json();
    expect(body.total_minted).toBe(21);
    expect(body.is_capped).toBe(true);
    expect(body.coins_until_next_milestone).toBe(0);
  });
});
