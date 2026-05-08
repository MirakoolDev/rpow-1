# Difficulty Schedule + 21M Supply Cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Bitcoin-style supply cap of 21M tokens by raising mining difficulty +1 bit every 1M tokens minted, plus a hard cap that refuses any mint past 21M.

**Architecture:** One pure schedule module (`apps/server/src/schedule.ts`) provides `difficultyForSupply()` and `epochInfo()`. `/challenge` reads live mint count, computes difficulty from the schedule, stamps it on the challenge row (existing behavior — only the source of difficulty changes). `/mint` adds an advisory-lock-guarded cap check inside its existing transaction. `/ledger` adds additive epoch fields. No DB migration. Spec: `docs/superpowers/specs/2026-05-07-difficulty-schedule-design.md`.

**Tech Stack:** TypeScript, Fastify, node-postgres, vitest, Postgres advisory locks.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/server/src/schedule.ts` | **create** | Pure functions: `difficultyForSupply`, `epochInfo`. No I/O. |
| `apps/server/tests/schedule.test.ts` | **create** | Unit tests for the pure schedule functions. |
| `apps/server/src/env.ts` | modify | Add `MINT_EPOCH_SIZE` and `MINT_MAX_SUPPLY` env vars (with prod defaults) so tests can override. |
| `apps/server/src/buildApp.ts` | modify | Add `mintEpochSize`, `mintMaxSupply` to `AppConfig`. |
| `apps/server/src/server.ts` | modify | Wire new env vars into `AppConfig`. |
| `apps/server/tests/helpers.ts` | modify | Pass small `mintEpochSize` / `mintMaxSupply` to test fixture so boundary tests are fast. |
| `apps/server/src/routes/challenge.ts` | modify | Replace static config difficulty with `difficultyForSupply(liveCount)`. Refuse with 410 SUPPLY_EXHAUSTED past cap. |
| `apps/server/tests/challenge.test.ts` | modify | Add tests for dynamic difficulty + cap rejection. |
| `apps/server/src/routes/mint.ts` | modify | Add `pg_advisory_xact_lock` + cap check inside the existing tx. |
| `apps/server/tests/mint.test.ts` | modify | Add tests for cap rejection + concurrent-mint serialization. |
| `apps/server/src/routes/ledger.ts` | modify | Add epoch fields to response via `epochInfo()`. |
| `apps/server/tests/ledger.test.ts` | modify | Update assertions for new fields. |

---

## Conventions used by every task

- All commands assume cwd = `~/rpow`.
- Tests run with `TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres` (the existing local-dev Postgres documented in the README).
- Each task's final step is a commit. Use the existing repo's commit-message style (`feat(server):`, `test(server):`, etc., based on `git log`).

---

## Task 1: Pure schedule module + unit tests

**Files:**
- Create: `apps/server/src/schedule.ts`
- Create: `apps/server/tests/schedule.test.ts`

This task is pure — no config plumbing, no DB. Tests pass options directly to the functions.

- [ ] **Step 1.1: Write the failing unit tests**

Create `apps/server/tests/schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { difficultyForSupply, epochInfo } from '../src/schedule.js';

describe('difficultyForSupply (production defaults: base=25, epoch=1M, max=21M)', () => {
  it('returns base bits at supply 0', () => {
    expect(difficultyForSupply(0)).toBe(25);
  });
  it('returns base bits just below first milestone', () => {
    expect(difficultyForSupply(999_999)).toBe(25);
  });
  it('bumps +1 bit at first milestone', () => {
    expect(difficultyForSupply(1_000_000)).toBe(26);
  });
  it('bumps to 27 in mid-epoch 2', () => {
    expect(difficultyForSupply(2_500_000)).toBe(27);
  });
  it('reaches 45 bits at last legal epoch', () => {
    expect(difficultyForSupply(20_999_999)).toBe(45);
  });
  it('clamps difficulty at maxEpoch even past cap', () => {
    expect(difficultyForSupply(21_000_000)).toBe(45);
    expect(difficultyForSupply(50_000_000)).toBe(45);
  });
});

describe('difficultyForSupply with test overrides', () => {
  const opts = { baseBits: 4, epochSize: 10, maxSupply: 21 };
  it('starts at baseBits', () => {
    expect(difficultyForSupply(0, opts)).toBe(4);
  });
  it('bumps at epochSize', () => {
    expect(difficultyForSupply(10, opts)).toBe(5);
  });
  it('clamps at maxEpoch (= maxSupply/epochSize - 1)', () => {
    // maxEpoch = floor(21/10) - 1 = 1, so bits = 4 + 1 = 5 once past first milestone
    expect(difficultyForSupply(15, opts)).toBe(5);
    expect(difficultyForSupply(20, opts)).toBe(5);
    expect(difficultyForSupply(21, opts)).toBe(5);
  });
});

describe('epochInfo', () => {
  it('reports progress mid-epoch with production defaults', () => {
    expect(epochInfo(500_000)).toEqual({
      epoch: 0,
      currentBits: 25,
      nextMilestoneAt: 1_000_000,
      coinsToNext: 500_000,
      nextDifficultyBits: 26,
      isCapped: false,
    });
  });
  it('reports the first boundary as the start of epoch 1', () => {
    expect(epochInfo(1_000_000)).toEqual({
      epoch: 1,
      currentBits: 26,
      nextMilestoneAt: 2_000_000,
      coinsToNext: 1_000_000,
      nextDifficultyBits: 27,
      isCapped: false,
    });
  });
  it('marks isCapped at maxSupply', () => {
    const info = epochInfo(21_000_000);
    expect(info.isCapped).toBe(true);
    expect(info.coinsToNext).toBe(0);
  });
  it('marks isCapped past maxSupply', () => {
    expect(epochInfo(99_999_999).isCapped).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run the tests and verify they fail**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run schedule.test.ts
```

Expected: tests fail with `Cannot find module '../src/schedule.js'`.

- [ ] **Step 1.3: Create the schedule module**

Create `apps/server/src/schedule.ts`:

```ts
export const MINT_BASE_BITS = 25;
export const MINT_EPOCH_SIZE = 1_000_000;
export const MINT_MAX_SUPPLY = 21_000_000;

export interface ScheduleOpts {
  baseBits?: number;
  epochSize?: number;
  maxSupply?: number;
}

export interface EpochInfo {
  epoch: number;
  currentBits: number;
  nextMilestoneAt: number;
  coinsToNext: number;
  nextDifficultyBits: number;
  isCapped: boolean;
}

function resolve(opts?: ScheduleOpts) {
  const baseBits = opts?.baseBits ?? MINT_BASE_BITS;
  const epochSize = opts?.epochSize ?? MINT_EPOCH_SIZE;
  const maxSupply = opts?.maxSupply ?? MINT_MAX_SUPPLY;
  // Last legal epoch index. e.g. with epochSize=1M and maxSupply=21M, the last
  // mint legal under cap is the one taking supply from 20,999,999 → 21,000,000,
  // i.e. epoch index 20.
  const maxEpoch = Math.max(0, Math.floor(maxSupply / epochSize) - 1);
  return { baseBits, epochSize, maxSupply, maxEpoch };
}

export function difficultyForSupply(mintedCount: number, opts?: ScheduleOpts): number {
  const { baseBits, epochSize, maxEpoch } = resolve(opts);
  const rawEpoch = Math.floor(Math.max(0, mintedCount) / epochSize);
  const epoch = Math.min(rawEpoch, maxEpoch);
  return baseBits + epoch;
}

export function epochInfo(mintedCount: number, opts?: ScheduleOpts): EpochInfo {
  const { baseBits, epochSize, maxSupply, maxEpoch } = resolve(opts);
  const isCapped = mintedCount >= maxSupply;
  const rawEpoch = Math.floor(Math.max(0, mintedCount) / epochSize);
  const epoch = Math.min(rawEpoch, maxEpoch);
  const currentBits = baseBits + epoch;
  const nextMilestoneAt = isCapped ? maxSupply : Math.min((epoch + 1) * epochSize, maxSupply);
  const coinsToNext = Math.max(0, nextMilestoneAt - mintedCount);
  const nextDifficultyBits = epoch < maxEpoch ? currentBits + 1 : currentBits;
  return { epoch, currentBits, nextMilestoneAt, coinsToNext, nextDifficultyBits, isCapped };
}
```

- [ ] **Step 1.4: Run the tests and verify they pass**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run schedule.test.ts
```

Expected: all tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add apps/server/src/schedule.ts apps/server/tests/schedule.test.ts
git commit -m "feat(server): pure schedule module for difficulty + 21M cap"
```

---

## Task 2: Plumb schedule overrides through env + AppConfig

**Files:**
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/buildApp.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/tests/helpers.ts`

The schedule module accepts `epochSize` and `maxSupply` as opts; this task wires those values into `app.config` so the route handlers can pass them through. Tests use small overrides so boundaries are fast to hit.

- [ ] **Step 2.1: Add env vars with prod defaults**

In `apps/server/src/env.ts`, extend the `Schema` object. Insert these two lines immediately after `DIFFICULTY_FLOOR`:

```ts
  MINT_EPOCH_SIZE: z.coerce.number().int().positive().default(1_000_000),
  MINT_MAX_SUPPLY: z.coerce.number().int().positive().default(21_000_000),
```

Final relevant region of `apps/server/src/env.ts`:

```ts
  DIFFICULTY_BITS: z.coerce.number().int().min(4).max(40).default(28),
  DIFFICULTY_FLOOR: z.coerce.number().int().min(4).max(40).default(20),
  MINT_EPOCH_SIZE: z.coerce.number().int().positive().default(1_000_000),
  MINT_MAX_SUPPLY: z.coerce.number().int().positive().default(21_000_000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
```

- [ ] **Step 2.2: Add fields to `AppConfig`**

In `apps/server/src/buildApp.ts`, add two fields to the `AppConfig` interface (after `difficultyFloor`):

```ts
export interface AppConfig {
  sessionSecret: string;
  magicLinkBaseUrl: string;
  difficultyBits: number;
  difficultyFloor: number;
  mintEpochSize: number;
  mintMaxSupply: number;
  signingPrivateKeyHex: string;
  signingPublicKeyHex: string;
  webOrigin: string;
  secureCookies: boolean;
}
```

- [ ] **Step 2.3: Wire env → AppConfig at startup**

In `apps/server/src/server.ts`, in the `buildApp({ ..., config: { ... } })` call, add two lines after `difficultyFloor`:

```ts
    difficultyFloor: env.DIFFICULTY_FLOOR,
    mintEpochSize: env.MINT_EPOCH_SIZE,
    mintMaxSupply: env.MINT_MAX_SUPPLY,
```

- [ ] **Step 2.4: Add small overrides to the test helper**

In `apps/server/tests/helpers.ts`, in the `config` object passed to `buildApp`, add two lines after `difficultyFloor`:

```ts
      difficultyBits: 8,
      difficultyFloor: 4,
      mintEpochSize: 10,
      mintMaxSupply: 21,
```

This makes the test fixture's "epoch 1" boundary at 10 minted tokens and cap at 21 — small enough that integration tests can seed boundaries with direct SQL inserts.

- [ ] **Step 2.5: Run all server tests, verify still green (no functional change yet)**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run
```

Expected: all existing tests pass. The `AppConfig` type addition and helper update should compile cleanly.

- [ ] **Step 2.6: Commit**

```bash
git add apps/server/src/env.ts apps/server/src/buildApp.ts apps/server/src/server.ts apps/server/tests/helpers.ts
git commit -m "chore(server): plumb mintEpochSize + mintMaxSupply through AppConfig"
```

---

## Task 3: Wire schedule into `/challenge` + integration tests

**Files:**
- Modify: `apps/server/src/routes/challenge.ts`
- Modify: `apps/server/tests/challenge.test.ts`

`/challenge` will read the live mint count, compute scheduled difficulty, and refuse with 410 SUPPLY_EXHAUSTED at the cap.

- [ ] **Step 3.1: Write the failing tests**

In `apps/server/tests/challenge.test.ts`, append the following inside the existing `describe('POST /challenge', ...)` block (before the closing `});`):

```ts
  async function seedRootTokens(ctx: Awaited<ReturnType<typeof makeTestApp>>, n: number) {
    // Test fixture has mintEpochSize=10, mintMaxSupply=21. Insert n root tokens
    // directly so we can drive the schedule without doing real PoW work.
    for (let i = 0; i < n; i++) {
      await ctx.pool.query(
        `INSERT INTO tokens(id, owner_email, value, state, server_sig)
         VALUES (gen_random_uuid(), $1, 1, 'VALID', '\\x00')`,
        [`seed-${i}@x.com`],
      );
    }
  }

  it('stamps base difficulty (8) below first milestone', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const cookie = await login(ctx);
    await seedRootTokens(ctx, 5); // supply = 5, epoch 0
    const body = (await ctx.app.inject({ method: 'POST', url: '/challenge', headers: { cookie } })).json();
    expect(body.difficulty_bits).toBe(8);
  });

  it('stamps +1 bit (9) past first milestone', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const cookie = await login(ctx);
    await seedRootTokens(ctx, 10); // supply = 10, epoch 1
    const body = (await ctx.app.inject({ method: 'POST', url: '/challenge', headers: { cookie } })).json();
    expect(body.difficulty_bits).toBe(9);
  });

  it('refuses with 410 SUPPLY_EXHAUSTED at cap', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const cookie = await login(ctx);
    await seedRootTokens(ctx, 21); // supply = 21, at cap
    const res = await ctx.app.inject({ method: 'POST', url: '/challenge', headers: { cookie } });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe('SUPPLY_EXHAUSTED');
  });
```

Note: `gen_random_uuid()` requires the `pgcrypto` extension. If it's not available in the test DB, swap to a JS-side `randomUUID()` and pass as a parameter. Verify by inspecting `apps/server/migrations/001_init.sql` — but the existing `users.email` PRIMARY KEY and `tokens.id UUID PRIMARY KEY` schema suggest UUIDs are externally provided. Use `randomUUID()` instead for portability:

```ts
  async function seedRootTokens(ctx: Awaited<ReturnType<typeof makeTestApp>>, n: number) {
    const { randomUUID } = await import('node:crypto');
    for (let i = 0; i < n; i++) {
      await ctx.pool.query(
        `INSERT INTO tokens(id, owner_email, value, state, server_sig)
         VALUES ($1, $2, 1, 'VALID', '\\x00')`,
        [randomUUID(), `seed-${i}@x.com`],
      );
    }
  }
```

- [ ] **Step 3.2: Run the failing tests**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run challenge.test.ts
```

Expected: the three new tests fail. The first existing test (which expects `difficulty_bits === 8`) should still pass since base bits = 8 and supply is 0 in that test.

- [ ] **Step 3.3: Update `/challenge` to use the schedule**

Replace the entire body of `apps/server/src/routes/challenge.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { readSession } from './auth.js';
import { difficultyForSupply } from '../schedule.js';

export async function challengeRoutes(app: FastifyInstance) {
  app.post('/challenge', async (req, reply) => {
    const s = readSession(req as any, app.config.sessionSecret);
    if (!s) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'login required' });

    const { rows } = await app.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tokens WHERE parent_token_id IS NULL`,
    );
    const minted = rows[0]!.n;
    if (minted >= app.config.mintMaxSupply) {
      return reply.code(410).send({ error: 'SUPPLY_EXHAUSTED', message: '21M cap reached' });
    }

    const scheduledBits = difficultyForSupply(minted, {
      baseBits: app.config.difficultyBits,
      epochSize: app.config.mintEpochSize,
      maxSupply: app.config.mintMaxSupply,
    });
    const difficulty = Math.max(app.config.difficultyFloor, scheduledBits);

    const id = randomUUID();
    const noncePrefix = randomBytes(16);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await app.pool.query(
      'INSERT INTO challenges(id, user_email, nonce_prefix, difficulty_bits, expires_at) VALUES($1,$2,$3,$4,$5)',
      [id, s.email, noncePrefix, difficulty, expiresAt],
    );
    return {
      challenge_id: id,
      nonce_prefix: noncePrefix.toString('hex'),
      difficulty_bits: difficulty,
      expires_at: expiresAt.toISOString(),
    };
  });
}
```

- [ ] **Step 3.4: Run the tests and verify all pass**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run challenge.test.ts
```

Expected: all challenge tests pass (existing + 3 new).

- [ ] **Step 3.5: Commit**

```bash
git add apps/server/src/routes/challenge.ts apps/server/tests/challenge.test.ts
git commit -m "feat(server): /challenge uses supply-aware difficulty schedule"
```

---

## Task 4: Hard-cap `/mint` with advisory lock

**Files:**
- Modify: `apps/server/src/routes/mint.ts`
- Modify: `apps/server/tests/mint.test.ts`

`/challenge` already refuses past cap, but a challenge issued just below cap could still mint past it via concurrent requests. `/mint` adds an advisory-lock-guarded cap check inside its existing transaction.

- [ ] **Step 4.1: Write the failing tests**

In `apps/server/tests/mint.test.ts`, append the following inside the existing `describe('POST /mint', ...)` block (before the closing `});`). Place after the existing tests:

```ts
  async function seedRootTokens(ctx: Awaited<ReturnType<typeof makeTestApp>>, n: number, ownerPrefix = 'seed') {
    const { randomUUID } = await import('node:crypto');
    for (let i = 0; i < n; i++) {
      await ctx.pool.query(
        `INSERT INTO tokens(id, owner_email, value, state, server_sig)
         VALUES ($1, $2, 1, 'VALID', '\\x00')`,
        [randomUUID(), `${ownerPrefix}-${i}@x.com`],
      );
    }
  }

  it('refuses with 410 SUPPLY_EXHAUSTED when cap is reached between challenge and mint', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    const { cookie, ch } = await loginAndChallenge(ctx);
    // Challenge was issued at supply=0 with difficulty 8. Now race the cap by
    // seeding directly to maxSupply (21).
    await seedRootTokens(ctx, 21);
    const nonce = findSolutionForTest(Buffer.from(ch.nonce_prefix, 'hex'), ch.difficulty_bits);
    const res = await ctx.app.inject({
      method: 'POST', url: '/mint',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { challenge_id: ch.challenge_id, solution_nonce: nonce.toString() },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe('SUPPLY_EXHAUSTED');
  });

  it('serializes concurrent mints at the cap boundary so only one succeeds', async () => {
    const ctx = await makeTestApp(); cleanup = ctx.cleanup;
    // Pre-seed to supply=20. Cap is 21. We'll issue 5 challenges across 5 users
    // and fire 5 mints in parallel; exactly 1 should succeed.
    await seedRootTokens(ctx, 20, 'pad');

    const cookies: string[] = [];
    const challenges: Array<{ challenge_id: string; nonce_prefix: string; difficulty_bits: number }> = [];
    for (let i = 0; i < 5; i++) {
      const email = `racer-${i}@x.com`;
      await ctx.app.inject({ method: 'POST', url: '/auth/request', payload: { email }, headers: { 'content-type': 'application/json' } });
      const tok = ctx.mailer.outbox.at(-1)!.text.match(/token=([\w-]+)/)![1];
      const r = await ctx.app.inject({ method: 'GET', url: `/auth/verify?token=${tok}` });
      const cookie = r.headers['set-cookie'] as string;
      cookies.push(cookie);
      const ch = (await ctx.app.inject({ method: 'POST', url: '/challenge', headers: { cookie } })).json();
      challenges.push(ch);
    }

    // Pre-mine all 5 nonces (supply was 20 when each challenge issued, so all 5
    // were stamped at the same difficulty. They're all valid solutions.)
    const nonces = challenges.map(ch =>
      findSolutionForTest(Buffer.from(ch.nonce_prefix, 'hex'), ch.difficulty_bits)
    );

    const results = await Promise.all(
      challenges.map((ch, i) =>
        ctx.app.inject({
          method: 'POST', url: '/mint',
          headers: { cookie: cookies[i], 'content-type': 'application/json' },
          payload: { challenge_id: ch.challenge_id, solution_nonce: nonces[i].toString() },
        }),
      ),
    );

    const successes = results.filter(r => r.statusCode === 200);
    const exhausted = results.filter(r => r.statusCode === 410 && r.json().error === 'SUPPLY_EXHAUSTED');
    expect(successes.length).toBe(1);
    expect(exhausted.length).toBe(4);
  });
```

- [ ] **Step 4.2: Run the failing tests**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run mint.test.ts
```

Expected: the two new tests fail. Existing mint tests still pass.

- [ ] **Step 4.3: Add advisory lock + cap check to `/mint`**

In `apps/server/src/routes/mint.ts`, replace the body of the `withTx` callback with the new ordering. Specifically replace this block:

```ts
    const result = await withTx(app.pool, async (c) => {
      const { rows } = await c.query<{ id: string; nonce_prefix: Buffer; difficulty_bits: number; expires_at: Date; claimed_at: Date | null }>(
        'SELECT id, nonce_prefix, difficulty_bits, expires_at, claimed_at FROM challenges WHERE id=$1 AND user_email=$2 FOR UPDATE',
        [parsed.data.challenge_id, s.email],
      );
      const ch = rows[0];
      if (!ch) return { error: 'BAD_REQUEST' as const, message: 'unknown challenge' };
      if (ch.claimed_at) return { error: 'CHALLENGE_ALREADY_CLAIMED' as const, message: 'already claimed' };
      if (ch.expires_at.getTime() < Date.now()) return { error: 'CHALLENGE_EXPIRED' as const, message: 'expired' };

      const nonce = BigInt(parsed.data.solution_nonce);
      if (!verifySolution(ch.nonce_prefix, nonce, ch.difficulty_bits)) {
        return { error: 'INVALID_SOLUTION' as const, message: 'hash does not meet difficulty' };
      }

      await c.query('UPDATE challenges SET claimed_at=now() WHERE id=$1', [ch.id]);

      const tokenId = randomUUID();
      const issuedAt = new Date();
      const ownerHash = createHash('sha256').update(s.email).digest('hex');
      const sig = signTokenPayload(
        { id: tokenId, owner_email_hash: ownerHash, value: 1, issued_at: issuedAt.toISOString() },
        app.config.signingPrivateKeyHex,
      );
      await c.query(
        `INSERT INTO tokens(id, owner_email, value, state, issued_at, server_sig)
         VALUES($1, $2, 1, 'VALID', $3, $4)`,
        [tokenId, s.email, issuedAt, sig],
      );
      return { token: { id: tokenId, value: 1, issued_at: issuedAt.toISOString() } };
    });
```

with:

```ts
    const result = await withTx(app.pool, async (c) => {
      // Serialize all mint commits on a single advisory lock so the cap check
      // and INSERT are race-free without resorting to SERIALIZABLE retries.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('rpow_mint_supply'))`);

      const { rows } = await c.query<{ id: string; nonce_prefix: Buffer; difficulty_bits: number; expires_at: Date; claimed_at: Date | null }>(
        'SELECT id, nonce_prefix, difficulty_bits, expires_at, claimed_at FROM challenges WHERE id=$1 AND user_email=$2 FOR UPDATE',
        [parsed.data.challenge_id, s.email],
      );
      const ch = rows[0];
      if (!ch) return { error: 'BAD_REQUEST' as const, message: 'unknown challenge' };
      if (ch.claimed_at) return { error: 'CHALLENGE_ALREADY_CLAIMED' as const, message: 'already claimed' };
      if (ch.expires_at.getTime() < Date.now()) return { error: 'CHALLENGE_EXPIRED' as const, message: 'expired' };

      const nonce = BigInt(parsed.data.solution_nonce);
      if (!verifySolution(ch.nonce_prefix, nonce, ch.difficulty_bits)) {
        return { error: 'INVALID_SOLUTION' as const, message: 'hash does not meet difficulty' };
      }

      const supplyRows = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tokens WHERE parent_token_id IS NULL`,
      );
      if (supplyRows.rows[0]!.n >= app.config.mintMaxSupply) {
        return { error: 'SUPPLY_EXHAUSTED' as const, message: '21M cap reached' };
      }

      await c.query('UPDATE challenges SET claimed_at=now() WHERE id=$1', [ch.id]);

      const tokenId = randomUUID();
      const issuedAt = new Date();
      const ownerHash = createHash('sha256').update(s.email).digest('hex');
      const sig = signTokenPayload(
        { id: tokenId, owner_email_hash: ownerHash, value: 1, issued_at: issuedAt.toISOString() },
        app.config.signingPrivateKeyHex,
      );
      await c.query(
        `INSERT INTO tokens(id, owner_email, value, state, issued_at, server_sig)
         VALUES($1, $2, 1, 'VALID', $3, $4)`,
        [tokenId, s.email, issuedAt, sig],
      );
      return { token: { id: tokenId, value: 1, issued_at: issuedAt.toISOString() } };
    });
```

Then update the response status mapping. Replace:

```ts
    if ('error' in result) {
      const status = result.error === 'CHALLENGE_EXPIRED' ? 410 : 400;
      return reply.code(status).send(result);
    }
```

with:

```ts
    if ('error' in result) {
      const status = result.error === 'CHALLENGE_EXPIRED' || result.error === 'SUPPLY_EXHAUSTED' ? 410 : 400;
      return reply.code(status).send(result);
    }
```

- [ ] **Step 4.4: Run the tests and verify all pass**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run mint.test.ts
```

Expected: all mint tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/server/src/routes/mint.ts apps/server/tests/mint.test.ts
git commit -m "feat(server): hard 21M cap on /mint via advisory-lock supply check"
```

---

## Task 5: Extend `/ledger` with epoch fields

**Files:**
- Modify: `apps/server/src/routes/ledger.ts`
- Modify: `apps/server/tests/ledger.test.ts`

Surface the schedule state to the web UI (and to anyone polling the public ledger endpoint).

- [ ] **Step 5.1: Update the failing test**

Replace the body of `apps/server/tests/ledger.test.ts` with:

```ts
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
```

- [ ] **Step 5.2: Run the failing tests**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run ledger.test.ts
```

Expected: tests fail because the new fields aren't in the response yet.

- [ ] **Step 5.3: Update `/ledger` to include schedule fields**

Replace the body of `apps/server/src/routes/ledger.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import { difficultyForSupply, epochInfo } from '../schedule.js';

export async function ledgerRoutes(app: FastifyInstance) {
  app.get('/ledger', async () => {
    const [{ rows: minted }, { rows: transferred }, { rows: circ }, { rows: users }] = await Promise.all([
      app.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM tokens WHERE parent_token_id IS NULL`),
      app.pool.query<{ n: number }>(`SELECT coalesce(sum(amount),0)::int AS n FROM transfers`),
      app.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM tokens WHERE state='VALID'`),
      app.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`),
    ]);
    const totalMinted = minted[0]!.n;
    const opts = {
      baseBits: app.config.difficultyBits,
      epochSize: app.config.mintEpochSize,
      maxSupply: app.config.mintMaxSupply,
    };
    const scheduledBits = difficultyForSupply(totalMinted, opts);
    const currentDifficultyBits = Math.max(app.config.difficultyFloor, scheduledBits);
    const info = epochInfo(totalMinted, opts);

    return {
      total_minted: totalMinted,
      total_transferred: transferred[0]!.n,
      circulating_supply: circ[0]!.n,
      current_difficulty_bits: currentDifficultyBits,
      user_count: users[0]!.n,
      max_supply: app.config.mintMaxSupply,
      epoch: info.epoch,
      epoch_size: app.config.mintEpochSize,
      next_milestone_at: info.nextMilestoneAt,
      coins_until_next_milestone: info.coinsToNext,
      next_difficulty_bits: info.nextDifficultyBits,
      is_capped: info.isCapped,
    };
  });
}
```

- [ ] **Step 5.4: Run the tests and verify all pass**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run ledger.test.ts
```

Expected: all ledger tests pass.

- [ ] **Step 5.5: Run the full server test suite**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55432/postgres \
  npm --workspace @rpow/server test -- --run
```

Expected: every test passes. The full suite is a regression sanity check — auth, send, claim, activity, etc. should all still be green.

- [ ] **Step 5.6: Commit**

```bash
git add apps/server/src/routes/ledger.ts apps/server/tests/ledger.test.ts
git commit -m "feat(server): /ledger surfaces epoch progress + cap status"
```

---

## Final verification

- [ ] **All 5 commits are present:**

```bash
git log --oneline -6
```

Expected (newest first):
```
<sha> feat(server): /ledger surfaces epoch progress + cap status
<sha> feat(server): hard 21M cap on /mint via advisory-lock supply check
<sha> feat(server): /challenge uses supply-aware difficulty schedule
<sha> chore(server): plumb mintEpochSize + mintMaxSupply through AppConfig
<sha> feat(server): pure schedule module for difficulty + 21M cap
<sha> docs(spec): difficulty schedule + 21M supply cap design
```

- [ ] **Push and deploy via existing Fly pipeline:**

Push when ready (user action):
```bash
git push origin main
fly deploy -a rpow2-server
```

The deployment is zero-downtime. After deploy:
- Existing 16,903+ root tokens grandfather in via the live count.
- Difficulty stays at 25 (current 16,903 < 1,000,000 → epoch 0).
- `/ledger` immediately reports new epoch fields.
- The first epoch transition fires when supply crosses 1,000,000.

---

## Out of scope (separate tickets)

- **Web UI:** display "X coins until next halving" using the new `/ledger` fields, and surface `SUPPLY_EXHAUSTED` errors gracefully.
- **Counter-table optimization:** if sustained mint throughput exceeds ~100/sec, replace the live `count(*)` + advisory lock with an incrementing counter row.
- **OpenAPI schema:** if/when a formal contract exists, add the new `/ledger` fields and `SUPPLY_EXHAUSTED` error.
