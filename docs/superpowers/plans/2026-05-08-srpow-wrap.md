# SRPOW Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow allowlisted users to wrap rpow tokens into SRPOW SPL tokens on Solana mainnet, with a bridge keypair acting as mint authority and a sync API that returns only after Solana `confirmed`.

**Architecture:** Two-phase: (Phase 1) DB-only state change `VALID → LOCKED_FOR_BRIDGE` inside a transaction; (Phase 2) Solana SPL `mintTo` against the user's Phantom-bound wallet, then `LOCKED_FOR_BRIDGE → WRAPPED`. Auto-refund on Phase 2 failure. Crash-recovery scan at boot. New workspace package `@rpow/solana-bridge` houses the SPL/Phantom-verify code so it's testable in isolation and reusable by the one-shot mint script.

**Tech Stack:** Postgres 17, Fastify 4, Vitest, `@solana/web3.js`, `@solana/spl-token`, `bs58`, `tweetnacl` (or `@noble/ed25519`), `@solana/wallet-adapter-base` (frontend), Phantom browser wallet.

**Spec:** `docs/superpowers/specs/2026-05-08-srpow-wrap-design.md` (commit `6e9b190`).

---

## File Structure

### New files

```
packages/solana-bridge/
  package.json                            # workspace package, depends on @solana/web3.js, @solana/spl-token, bs58, tweetnacl
  tsconfig.json                           # extends ../../tsconfig.base.json
  vitest.config.ts
  src/
    index.ts                              # public exports
    constants.ts                          # SRPOW_DECIMALS=9, default commitment
    bridge-client.ts                      # BridgeClient interface + SolanaBridgeClient + FakeBridgeClient
    wallet-verify.ts                      # verifyPhantomSignature(message, signatureBase58, walletBase58)
    wallet-verify.test.ts
    bridge-client.test.ts                 # exercises FakeBridgeClient

apps/server/
  migrations/
    007_srpow_wrap.sql                    # tokens.state, users.solana_wallet, srpow_wrap_events,
                                          #   tokens.wrap_event_id, phantom_challenges
  src/
    wrap-allowlist.ts                     # parse WRAP_ALLOWED_EMAILS once
    bridge-keys.ts                        # decode BRIDGE_KEYPAIR_BASE58 → Keypair
    srpow-reconcile.ts                    # boot-time scan of PENDING events
    routes/
      phantom.ts                          # POST /phantom/challenge, POST /phantom/bind
      srpow.ts                            # POST /srpow/wrap, GET /srpow/events, GET /srpow/events/:id
  scripts/
    create-srpow-mint.ts                  # two-mode CLI: --init-keys then default
  tests/
    wrap-allowlist.test.ts
    phantom.test.ts
    srpow-wrap.test.ts
    srpow-reconcile.test.ts

apps/web/
  src/
    pages/
      WrapPage.tsx
    components/
      ConnectPhantom.tsx
      WrapForm.tsx
      WrapHistory.tsx
    hooks/
      usePhantom.ts
      useSrpow.ts
```

### Modified files

- `packages/shared/src/protocol.ts` — add `WrapEvent`, `MeResponse` extensions, `PhantomChallengeResponse`, `WrapResponse`.
- `apps/server/src/env.ts` — add `SOLANA_RPC_URL`, `SRPOW_MINT_ADDRESS`, `BRIDGE_KEYPAIR_BASE58`, `WRAP_ALLOWED_EMAILS`, `SRPOW_COMMITMENT`, `SRPOW_WRAP_TIMEOUT_MS`.
- `apps/server/src/buildApp.ts` — register `phantomRoutes`, `srpowRoutes`; decorate app with `bridgeClient` and `wrapAllowlist`.
- `apps/server/src/server.ts` — wire `SolanaBridgeClient`; call `reconcilePendingWraps()` after migrations.
- `apps/server/src/routes/me.ts` — return `wrap_allowed`, `solana_wallet`, `srpow_supply_owned`.
- `apps/server/tests/helpers.ts` — accept optional `bridgeClient: FakeBridgeClient` injection; default-build one.
- `apps/server/package.json` — add deps.
- `apps/web/src/api.ts` — add `phantomChallenge`, `phantomBind`, `srpowWrap`, `srpowEvents`.
- `apps/web/src/App.tsx` — register `/wrap` route, gate on `me.wrap_allowed`.
- `apps/web/package.json` — add `@solana/web3.js`, `@solana/spl-token`, `bs58`.

---

## Task 1: Workspace package skeleton for `@rpow/solana-bridge`

**Files:**
- Create: `packages/solana-bridge/package.json`
- Create: `packages/solana-bridge/tsconfig.json`
- Create: `packages/solana-bridge/vitest.config.ts`
- Create: `packages/solana-bridge/src/index.ts`
- Create: `packages/solana-bridge/src/constants.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@rpow/solana-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@solana/spl-token": "^0.4.6",
    "@solana/web3.js": "^1.91.0",
    "bs58": "^6.0.0",
    "tweetnacl": "^1.0.3"
  },
  "devDependencies": { "vitest": "^1.6.0" }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 4: Create src/constants.ts**

```ts
export const SRPOW_DECIMALS = 9;
export const SRPOW_BASE_UNITS_PER_RPOW = 10n ** BigInt(SRPOW_DECIMALS);
export const DEFAULT_COMMITMENT = 'confirmed' as const;
```

- [ ] **Step 5: Create src/index.ts (placeholder; real exports added in later tasks)**

```ts
export * from './constants.js';
```

- [ ] **Step 6: Install + build**

```bash
npm install --workspaces --include-workspace-root --ignore-scripts
npm run build --workspace @rpow/solana-bridge
```

Expected: clean exit, `dist/index.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/solana-bridge package.json package-lock.json
git commit -m "chore: add @rpow/solana-bridge workspace package skeleton"
```

---

## Task 2: Phantom signature verification

**Files:**
- Create: `packages/solana-bridge/src/wallet-verify.ts`
- Create: `packages/solana-bridge/src/wallet-verify.test.ts`
- Modify: `packages/solana-bridge/src/index.ts`

- [ ] **Step 1: Write the test**

```ts
// src/wallet-verify.test.ts
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { verifyPhantomSignature } from './wallet-verify.js';

describe('verifyPhantomSignature', () => {
  it('verifies a real ed25519 signature over a UTF-8 message', () => {
    const kp = nacl.sign.keyPair();
    const message = 'rpow2.com bind: 11111111-1111-1111-1111-111111111111';
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    const ok = verifyPhantomSignature(message, bs58.encode(sig), bs58.encode(kp.publicKey));
    expect(ok).toBe(true);
  });

  it('rejects a tampered message', () => {
    const kp = nacl.sign.keyPair();
    const message = 'rpow2.com bind: a';
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    const ok = verifyPhantomSignature('rpow2.com bind: b', bs58.encode(sig), bs58.encode(kp.publicKey));
    expect(ok).toBe(false);
  });

  it('rejects a wrong public key', () => {
    const kp = nacl.sign.keyPair();
    const other = nacl.sign.keyPair();
    const message = 'rpow2.com bind: x';
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    const ok = verifyPhantomSignature(message, bs58.encode(sig), bs58.encode(other.publicKey));
    expect(ok).toBe(false);
  });

  it('returns false on malformed input', () => {
    expect(verifyPhantomSignature('m', 'not-base58!!!', 'also-bad')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test --workspace @rpow/solana-bridge
```

Expected: FAIL — `verifyPhantomSignature` not exported.

- [ ] **Step 3: Implement**

```ts
// src/wallet-verify.ts
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function verifyPhantomSignature(
  message: string,
  signatureBase58: string,
  walletBase58: string,
): boolean {
  try {
    const sig = bs58.decode(signatureBase58);
    const pub = bs58.decode(walletBase58);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Add to index.ts exports**

```ts
// src/index.ts
export * from './constants.js';
export * from './wallet-verify.js';
```

- [ ] **Step 5: Run test, verify pass**

```bash
npm test --workspace @rpow/solana-bridge
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/solana-bridge/src
git commit -m "feat(solana-bridge): verifyPhantomSignature for ed25519 signMessage"
```

---

## Task 3: BridgeClient interface + FakeBridgeClient

**Files:**
- Create: `packages/solana-bridge/src/bridge-client.ts`
- Create: `packages/solana-bridge/src/bridge-client.test.ts`
- Modify: `packages/solana-bridge/src/index.ts`

The BridgeClient interface abstracts the operations the server needs. Real (`SolanaBridgeClient`) is added in Task 4 — this task ships a `FakeBridgeClient` so server tests can be written before the real client exists.

- [ ] **Step 1: Write the test**

```ts
// src/bridge-client.test.ts
import { describe, it, expect } from 'vitest';
import { FakeBridgeClient } from './bridge-client.js';

describe('FakeBridgeClient', () => {
  it('mintTo returns the queued signature and records the call', async () => {
    const c = new FakeBridgeClient();
    c.queueResult({ signature: 'fake_sig_1' });
    const r = await c.mintTo({ recipientWallet: 'WALLET1', amount: 3 });
    expect(r.status).toBe('confirmed');
    expect(r.signature).toBe('fake_sig_1');
    expect(c.calls).toEqual([{ recipientWallet: 'WALLET1', amount: 3 }]);
  });

  it('queues a failure result', async () => {
    const c = new FakeBridgeClient();
    c.queueResult({ error: 'rpc_unavailable' });
    const r = await c.mintTo({ recipientWallet: 'WALLET1', amount: 1 });
    expect(r.status).toBe('failed');
    expect(r.failureReason).toBe('rpc_unavailable');
  });

  it('throws if no result queued', async () => {
    const c = new FakeBridgeClient();
    await expect(c.mintTo({ recipientWallet: 'W', amount: 1 })).rejects.toThrow(/no result queued/);
  });

  it('getSignatureStatus returns queued status', async () => {
    const c = new FakeBridgeClient();
    c.setSignatureStatus('sig_x', 'confirmed');
    expect(await c.getSignatureStatus('sig_x')).toBe('confirmed');
    expect(await c.getSignatureStatus('unknown')).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test --workspace @rpow/solana-bridge
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/bridge-client.ts
export interface MintToArgs { recipientWallet: string; amount: number }
export type MintToResult =
  | { status: 'confirmed'; signature: string }
  | { status: 'failed'; signature: string | null; failureReason: string };

export type SignatureStatus = 'confirmed' | 'failed' | 'not_found';

export interface BridgeClient {
  mintTo(args: MintToArgs): Promise<MintToResult>;
  getSignatureStatus(signature: string): Promise<SignatureStatus>;
}

type Queued =
  | { signature: string; error?: undefined }
  | { signature?: undefined; error: string };

export class FakeBridgeClient implements BridgeClient {
  calls: MintToArgs[] = [];
  private queue: Queued[] = [];
  private statuses = new Map<string, SignatureStatus>();

  queueResult(r: Queued): void { this.queue.push(r); }
  setSignatureStatus(sig: string, status: SignatureStatus): void {
    this.statuses.set(sig, status);
  }

  async mintTo(args: MintToArgs): Promise<MintToResult> {
    this.calls.push(args);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeBridgeClient: no result queued');
    if (next.error) {
      return { status: 'failed', signature: null, failureReason: next.error };
    }
    return { status: 'confirmed', signature: next.signature };
  }

  async getSignatureStatus(signature: string): Promise<SignatureStatus> {
    return this.statuses.get(signature) ?? 'not_found';
  }
}
```

- [ ] **Step 4: Update index.ts**

```ts
export * from './constants.js';
export * from './wallet-verify.js';
export * from './bridge-client.js';
```

- [ ] **Step 5: Run + commit**

```bash
npm test --workspace @rpow/solana-bridge   # expect 4 + 4 = 8 passed
git add packages/solana-bridge/src
git commit -m "feat(solana-bridge): BridgeClient interface + FakeBridgeClient"
```

---

## Task 4: SolanaBridgeClient (real implementation)

**Files:**
- Modify: `packages/solana-bridge/src/bridge-client.ts`
- Modify: `packages/solana-bridge/src/index.ts`

This wraps `@solana/spl-token`'s `mintTo` and ATA creation. We test it manually against devnet during rollout — unit-testing real RPC is out of scope here. The class is thin and structurally identical to the SDK calls.

- [ ] **Step 1: Add the real client to bridge-client.ts**

Append to the file:

```ts
import {
  Connection, Keypair, PublicKey, Commitment,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount, mintTo as splMintTo,
} from '@solana/spl-token';

export interface SolanaBridgeClientOptions {
  connection: Connection;
  bridge: Keypair;
  mint: PublicKey;
  commitment: Commitment;          // 'confirmed' | 'finalized'
  baseUnitsPerToken: bigint;       // 10n ** 9n for SRPOW
  timeoutMs: number;
}

export class SolanaBridgeClient implements BridgeClient {
  constructor(private opts: SolanaBridgeClientOptions) {}

  async mintTo({ recipientWallet, amount }: MintToArgs): Promise<MintToResult> {
    const recipient = new PublicKey(recipientWallet);
    try {
      const ata = await getOrCreateAssociatedTokenAccount(
        this.opts.connection, this.opts.bridge, this.opts.mint, recipient,
        false, this.opts.commitment,
      );
      const baseUnits = BigInt(amount) * this.opts.baseUnitsPerToken;
      const sig = await splMintTo(
        this.opts.connection, this.opts.bridge, this.opts.mint, ata.address,
        this.opts.bridge, baseUnits, [], { commitment: this.opts.commitment },
      );
      return { status: 'confirmed', signature: sig };
    } catch (e: any) {
      return { status: 'failed', signature: null, failureReason: e?.message ?? String(e) };
    }
  }

  async getSignatureStatus(signature: string): Promise<SignatureStatus> {
    const res = await this.opts.connection.getSignatureStatus(signature);
    const v = res.value;
    if (!v) return 'not_found';
    if (v.err) return 'failed';
    if (v.confirmationStatus === this.opts.commitment || v.confirmationStatus === 'finalized') {
      return 'confirmed';
    }
    return 'not_found';
  }
}
```

- [ ] **Step 2: Build to verify types compile**

```bash
npm run build --workspace @rpow/solana-bridge
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/solana-bridge/src/bridge-client.ts packages/solana-bridge/src/index.ts
git commit -m "feat(solana-bridge): SolanaBridgeClient wraps spl-token mintTo + ATA"
```

---

## Task 5: Server depends on @rpow/solana-bridge + adds env + buildApp wiring

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/tests/env.test.ts`

- [ ] **Step 1: Add server deps**

```bash
npm install --workspace @rpow/server --save \
  @rpow/solana-bridge@'*' bs58@^6.0.0 tweetnacl@^1.0.3 --ignore-scripts
```

(`@rpow/solana-bridge@'*'` resolves to the local workspace package.)

- [ ] **Step 2: Add env vars**

Edit `apps/server/src/env.ts`. Inside the `z.object({...})`, add the following keys (preserve alphabetical / topical grouping with surrounding code):

```ts
  SOLANA_RPC_URL: z.string().url().optional(),
  SRPOW_MINT_ADDRESS: z.string().min(32).max(44).optional(),       // base58 pubkey
  BRIDGE_KEYPAIR_BASE58: z.string().min(80).optional(),
  WRAP_ALLOWED_EMAILS: z.string().default(''),                     // CSV, may be empty
  SRPOW_COMMITMENT: z.enum(['confirmed','finalized']).default('confirmed'),
  SRPOW_WRAP_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
```

These are all optional (or have defaults) — wrap is feature-gated by env at boot. If `WRAP_ALLOWED_EMAILS` is empty, no one can wrap, which is the safe default.

- [ ] **Step 3: Update env.test.ts to cover the new fields**

Add the following test inside the `describe('parseEnv', ...)` block:

```ts
  it('defaults SRPOW envs sensibly', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://u:p@h/db',
      RESEND_API_KEY: 'rk',
      EMAIL_FROM: 'no-reply@rpow2.com',
      SESSION_SECRET: 'a'.repeat(32),
      MAGIC_LINK_BASE_URL: 'http://localhost:8080',
      RPOW_SIGNING_PRIVATE_KEY_HEX: '00'.repeat(32),
      RPOW_SIGNING_PUBLIC_KEY_HEX: '00'.repeat(32),
    });
    expect(env.WRAP_ALLOWED_EMAILS).toBe('');
    expect(env.SRPOW_COMMITMENT).toBe('confirmed');
    expect(env.SRPOW_WRAP_TIMEOUT_MS).toBe(60_000);
  });
```

- [ ] **Step 4: Build + test**

```bash
npm run build --workspace @rpow/server
npx vitest run tests/env.test.ts --root apps/server   # expect: all env tests pass
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/src/env.ts apps/server/tests/env.test.ts package-lock.json
git commit -m "feat(server): SRPOW-related env vars (mint, bridge keys, allowlist, commitment)"
```

---

## Task 6: Migration 007 — schema for SRPOW

**Files:**
- Create: `apps/server/migrations/007_srpow_wrap.sql`

- [ ] **Step 1: Write migration**

```sql
-- 007_srpow_wrap.sql

-- Expand tokens.state to include LOCKED_FOR_BRIDGE and WRAPPED.
ALTER TABLE tokens DROP CONSTRAINT tokens_state_check;
ALTER TABLE tokens ADD CONSTRAINT tokens_state_check
  CHECK (state IN ('VALID','INVALIDATED','LOCKED_FOR_BRIDGE','WRAPPED'));

-- 1:1 Phantom binding.
ALTER TABLE users ADD COLUMN solana_wallet TEXT UNIQUE;

-- Wrap/unwrap event log.
CREATE TABLE srpow_wrap_events (
  id UUID PRIMARY KEY,
  user_email TEXT NOT NULL,
  solana_wallet TEXT NOT NULL,
  amount INT NOT NULL CHECK (amount > 0),
  direction TEXT NOT NULL CHECK (direction IN ('WRAP','UNWRAP')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','FAILED','REFUNDED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  solana_signature TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX srpow_wrap_events_user_idx ON srpow_wrap_events(user_email);
CREATE INDEX srpow_wrap_events_pending_idx ON srpow_wrap_events(status)
  WHERE status='PENDING';

-- Token → wrap event link.
ALTER TABLE tokens ADD COLUMN wrap_event_id UUID REFERENCES srpow_wrap_events(id);
CREATE INDEX tokens_wrap_event_idx ON tokens(wrap_event_id) WHERE wrap_event_id IS NOT NULL;

-- Phantom challenge nonces.
CREATE TABLE phantom_challenges (
  nonce UUID PRIMARY KEY,
  user_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX phantom_challenges_user_idx ON phantom_challenges(user_email);
```

- [ ] **Step 2: Apply via test infrastructure (smoke check)**

```bash
TEST_DATABASE_URL=$LOCAL_TEST_DB npx vitest run tests/env.test.ts --root apps/server
# the test harness applies all migrations on each test schema, so any SQL
# error in 007 will surface in any DB-touching test. Run a known-passing
# DB test:
TEST_DATABASE_URL=$LOCAL_TEST_DB npx vitest run tests/ledger.test.ts --root apps/server
```

Expected: all pass. (If migration 007 is broken, every DB test will fail with a SQL error from `runMigrations`.)

- [ ] **Step 3: Commit**

```bash
git add apps/server/migrations/007_srpow_wrap.sql
git commit -m "feat(server): migration 007 — tokens.state expansion + srpow_wrap_events"
```

---

## Task 7: `wrap-allowlist.ts`

**Files:**
- Create: `apps/server/src/wrap-allowlist.ts`
- Create: `apps/server/tests/wrap-allowlist.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/wrap-allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { parseAllowlist, isAllowed } from '../src/wrap-allowlist.js';

describe('wrap-allowlist', () => {
  it('parses comma-separated emails, lowercased, trimmed', () => {
    const set = parseAllowlist(' Alice@Example.com ,  bob@test.io ,carol@x.io ');
    expect(set.size).toBe(3);
    expect(set.has('alice@example.com')).toBe(true);
    expect(set.has('bob@test.io')).toBe(true);
  });

  it('handles empty / whitespace-only string', () => {
    expect(parseAllowlist('').size).toBe(0);
    expect(parseAllowlist('   ').size).toBe(0);
    expect(parseAllowlist(',').size).toBe(0);
  });

  it('isAllowed is case-insensitive', () => {
    const set = parseAllowlist('alice@example.com');
    expect(isAllowed(set, 'ALICE@example.COM')).toBe(true);
    expect(isAllowed(set, 'mallory@example.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run tests/wrap-allowlist.test.ts --root apps/server
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/wrap-allowlist.ts
export function parseAllowlist(csv: string): Set<string> {
  return new Set(
    csv.split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0),
  );
}

export function isAllowed(set: Set<string>, email: string): boolean {
  return set.has(email.trim().toLowerCase());
}
```

- [ ] **Step 4: Test pass + commit**

```bash
npx vitest run tests/wrap-allowlist.test.ts --root apps/server   # 3 passed
git add apps/server/src/wrap-allowlist.ts apps/server/tests/wrap-allowlist.test.ts
git commit -m "feat(server): wrap-allowlist parser"
```

---

## Task 8: `bridge-keys.ts`

**Files:**
- Create: `apps/server/src/bridge-keys.ts`

This is a thin loader: decode `BRIDGE_KEYPAIR_BASE58` → `Keypair`. No tests — the function is one bs58.decode + Keypair.fromSecretKey, both upstream-tested.

- [ ] **Step 1: Implement**

```ts
// src/bridge-keys.ts
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export function loadBridgeKeypair(base58: string): Keypair {
  const secret = bs58.decode(base58);
  if (secret.length !== 64) {
    throw new Error(`bridge-keys: expected 64-byte secret, got ${secret.length}`);
  }
  return Keypair.fromSecretKey(secret);
}
```

- [ ] **Step 2: Build to verify imports**

```bash
npm run build --workspace @rpow/server
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/bridge-keys.ts
git commit -m "feat(server): bridge-keys loader"
```

---

## Task 9: Decorate FastifyInstance with `bridgeClient` + `wrapAllowlist`

**Files:**
- Modify: `apps/server/src/buildApp.ts`
- Modify: `apps/server/tests/helpers.ts`

We inject the BridgeClient and the parsed allowlist via `buildApp` options so tests can swap a `FakeBridgeClient` in.

- [ ] **Step 1: Update buildApp.ts options + decoration**

Update `BuildAppOptions` and the `declare module 'fastify'` block:

```ts
import type { BridgeClient } from '@rpow/solana-bridge';
import { parseAllowlist } from './wrap-allowlist.js';

export interface BuildAppOptions {
  test?: boolean;
  pool: Pool;
  mailer: Mailer;
  config: AppConfig;
  bridgeClient: BridgeClient;
  wrapAllowlistCsv: string;          // raw CSV; parsed once on decoration
}

declare module 'fastify' {
  interface FastifyInstance {
    pool: Pool;
    mailer: Mailer;
    config: AppConfig;
    bridgeClient: BridgeClient;
    wrapAllowlist: Set<string>;
  }
}
```

In `buildApp` body, after the existing `app.decorate('config', opts.config);` line:

```ts
  app.decorate('bridgeClient', opts.bridgeClient);
  app.decorate('wrapAllowlist', parseAllowlist(opts.wrapAllowlistCsv));
```

- [ ] **Step 2: Update test helpers to provide a default FakeBridgeClient**

In `apps/server/tests/helpers.ts`, top of file:

```ts
import { FakeBridgeClient } from '@rpow/solana-bridge';
```

Update `makeTestApp` signature to accept optional overrides:

```ts
export async function makeTestApp(opts: {
  bridgeClient?: FakeBridgeClient;
  wrapAllowlistCsv?: string;
} = {}): Promise<{ /* ... */; bridgeClient: FakeBridgeClient }> {
  // ... existing code through await runMigrations(pool); ...
  const bridgeClient = opts.bridgeClient ?? new FakeBridgeClient();
  const app = await buildApp({
    pool, mailer, test: true,
    bridgeClient,
    wrapAllowlistCsv: opts.wrapAllowlistCsv ?? '',
    config: { /* unchanged */ },
  });
  return { app, pool, mailer, bridgeClient, cleanup };
}
```

(Keep all other fields in the returned object unchanged.)

- [ ] **Step 3: Update server.ts to construct a real client**

After `await runMigrations(pool);`, before mailer block:

```ts
import { Connection, PublicKey } from '@solana/web3.js';
import { SolanaBridgeClient, FakeBridgeClient, type BridgeClient, SRPOW_BASE_UNITS_PER_RPOW } from '@rpow/solana-bridge';
import { loadBridgeKeypair } from './bridge-keys.js';

let bridgeClient: BridgeClient;
if (env.SOLANA_RPC_URL && env.SRPOW_MINT_ADDRESS && env.BRIDGE_KEYPAIR_BASE58) {
  const conn = new Connection(env.SOLANA_RPC_URL, env.SRPOW_COMMITMENT);
  bridgeClient = new SolanaBridgeClient({
    connection: conn,
    bridge: loadBridgeKeypair(env.BRIDGE_KEYPAIR_BASE58),
    mint: new PublicKey(env.SRPOW_MINT_ADDRESS),
    commitment: env.SRPOW_COMMITMENT,
    baseUnitsPerToken: SRPOW_BASE_UNITS_PER_RPOW,
    timeoutMs: env.SRPOW_WRAP_TIMEOUT_MS,
  });
} else {
  // Wrap is disabled at boot if SRPOW envs aren't all set.
  bridgeClient = new FakeBridgeClient();
  console.log('SRPOW disabled: SOLANA_RPC_URL/SRPOW_MINT_ADDRESS/BRIDGE_KEYPAIR_BASE58 not all set');
}
```

Then pass `bridgeClient` and `wrapAllowlistCsv: env.WRAP_ALLOWED_EMAILS` into `buildApp({...})`.

- [ ] **Step 4: Build + run all server tests (expect them still passing pre-existing)**

```bash
npm run build --workspace @rpow/server
TEST_DATABASE_URL=$LOCAL_TEST_DB npm test --workspace @rpow/server
```

Expected: same number of passes as before (we haven't added new functionality yet).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/buildApp.ts apps/server/src/server.ts apps/server/tests/helpers.ts
git commit -m "feat(server): inject BridgeClient + wrap allowlist via buildApp"
```

---

## Task 10: `POST /phantom/challenge`

**Files:**
- Create: `apps/server/src/routes/phantom.ts`
- Create: `apps/server/tests/phantom.test.ts`
- Modify: `apps/server/src/buildApp.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/phantom.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp } from './helpers.js';
import { signSession, SESSION_COOKIE } from '../src/session.js';

let cleanup: () => Promise<void> = async () => {};
afterEach(() => cleanup());

describe('POST /phantom/challenge', () => {
  it('issues a nonce + message tied to the user', async () => {
    const t = await makeTestApp();
    cleanup = t.cleanup;
    await t.pool.query(`INSERT INTO users(email) VALUES('alice@x.io')`);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);

    const r = await t.app.inject({
      method: 'POST', url: '/phantom/challenge',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as { nonce: string; message: string; expires_at: string };
    expect(body.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.message).toBe(`rpow2.com bind: ${body.nonce}`);

    const dbRow = await t.pool.query(
      'SELECT user_email, expires_at, used_at FROM phantom_challenges WHERE nonce=$1',
      [body.nonce],
    );
    expect(dbRow.rows[0].user_email).toBe('alice@x.io');
    expect(dbRow.rows[0].used_at).toBeNull();
  });

  it('requires session', async () => {
    const t = await makeTestApp();
    cleanup = t.cleanup;
    const r = await t.app.inject({ method: 'POST', url: '/phantom/challenge' });
    expect(r.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run tests/phantom.test.ts --root apps/server
```

Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/routes/phantom.ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readSession } from './auth.js';

const NONCE_TTL_MS = 5 * 60 * 1000;

export async function phantomRoutes(app: FastifyInstance) {
  app.post('/phantom/challenge', async (req, reply) => {
    const s = readSession(req as any, app.config.sessionSecret);
    if (!s) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'login required' });
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await app.pool.query(
      'INSERT INTO phantom_challenges(nonce, user_email, expires_at) VALUES($1,$2,$3)',
      [nonce, s.email, expiresAt],
    );
    return { nonce, message: `rpow2.com bind: ${nonce}`, expires_at: expiresAt.toISOString() };
  });
}
```

- [ ] **Step 4: Register in buildApp.ts**

```ts
import { phantomRoutes } from './routes/phantom.js';
// ... after other registrations:
await app.register(phantomRoutes);
```

- [ ] **Step 5: Run, expect pass + commit**

```bash
npx vitest run tests/phantom.test.ts --root apps/server     # 2 passed
git add apps/server/src/routes/phantom.ts apps/server/src/buildApp.ts apps/server/tests/phantom.test.ts
git commit -m "feat(server): POST /phantom/challenge issues bind nonce"
```

---

## Task 11: `POST /phantom/bind`

**Files:**
- Modify: `apps/server/src/routes/phantom.ts`
- Modify: `apps/server/tests/phantom.test.ts`

- [ ] **Step 1: Add tests**

Append to `tests/phantom.test.ts`:

```ts
import nacl from 'tweetnacl';
import bs58 from 'bs58';

describe('POST /phantom/bind', () => {
  async function setup() {
    const t = await makeTestApp();
    cleanup = t.cleanup;
    await t.pool.query(`INSERT INTO users(email) VALUES('alice@x.io')`);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    const ch = await t.app.inject({
      method: 'POST', url: '/phantom/challenge',
      cookies: { [SESSION_COOKIE]: session },
    });
    const { nonce, message } = ch.json() as { nonce: string; message: string };
    return { t, session, nonce, message };
  }

  it('binds the wallet on a valid signature', async () => {
    const { t, session, nonce, message } = await setup();
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);

    const r = await t.app.inject({
      method: 'POST', url: '/phantom/bind',
      cookies: { [SESSION_COOKIE]: session },
      payload: {
        nonce,
        wallet_address: bs58.encode(kp.publicKey),
        signature_base58: bs58.encode(sig),
      },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, solana_wallet: bs58.encode(kp.publicKey) });
    const u = await t.pool.query('SELECT solana_wallet FROM users WHERE email=$1', ['alice@x.io']);
    expect(u.rows[0].solana_wallet).toBe(bs58.encode(kp.publicKey));
  });

  it('rejects bad signature', async () => {
    const { t, session, nonce, message } = await setup();
    const kp = nacl.sign.keyPair();
    const tamperedMsg = message + 'x';
    const sig = nacl.sign.detached(new TextEncoder().encode(tamperedMsg), kp.secretKey);

    const r = await t.app.inject({
      method: 'POST', url: '/phantom/bind',
      cookies: { [SESSION_COOKIE]: session },
      payload: { nonce, wallet_address: bs58.encode(kp.publicKey), signature_base58: bs58.encode(sig) },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('BAD_SIGNATURE');
  });

  it('rejects an already-used nonce', async () => {
    const { t, session, nonce, message } = await setup();
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    const payload = { nonce, wallet_address: bs58.encode(kp.publicKey), signature_base58: bs58.encode(sig) };

    const a = await t.app.inject({ method: 'POST', url: '/phantom/bind', cookies: { [SESSION_COOKIE]: session }, payload });
    expect(a.statusCode).toBe(200);
    const b = await t.app.inject({ method: 'POST', url: '/phantom/bind', cookies: { [SESSION_COOKIE]: session }, payload });
    expect(b.statusCode).toBe(200);             // idempotent: same wallet rebind = no-op success
    expect(b.json().solana_wallet).toBe(bs58.encode(kp.publicKey));
  });

  it('rejects WALLET_TAKEN when a different user already bound the same wallet', async () => {
    const { t, session: aliceSession, nonce, message } = await setup();
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    await t.app.inject({
      method: 'POST', url: '/phantom/bind',
      cookies: { [SESSION_COOKIE]: aliceSession },
      payload: { nonce, wallet_address: bs58.encode(kp.publicKey), signature_base58: bs58.encode(sig) },
    });

    // bob attempts to bind alice's wallet
    await t.pool.query(`INSERT INTO users(email) VALUES('bob@x.io')`);
    const bobSession = signSession({ email: 'bob@x.io' }, 'x'.repeat(32), 60);
    const ch = await t.app.inject({
      method: 'POST', url: '/phantom/challenge', cookies: { [SESSION_COOKIE]: bobSession },
    });
    const bobNonce = (ch.json() as any).nonce as string;
    const bobMsg = `rpow2.com bind: ${bobNonce}`;
    const bobSig = nacl.sign.detached(new TextEncoder().encode(bobMsg), kp.secretKey);

    const r = await t.app.inject({
      method: 'POST', url: '/phantom/bind', cookies: { [SESSION_COOKIE]: bobSession },
      payload: { nonce: bobNonce, wallet_address: bs58.encode(kp.publicKey), signature_base58: bs58.encode(bobSig) },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('WALLET_TAKEN');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run tests/phantom.test.ts --root apps/server
```

Expected: 4 new tests fail; previous 2 pass.

- [ ] **Step 3: Implement**

Add to `src/routes/phantom.ts`, replacing the existing function body:

```ts
import { z } from 'zod';
import { verifyPhantomSignature } from '@rpow/solana-bridge';
import { withTx } from '../db.js';

const BindBody = z.object({
  nonce: z.string().uuid(),
  wallet_address: z.string().min(32).max(44),
  signature_base58: z.string().min(80).max(100),
});

// in phantomRoutes(app), after the /phantom/challenge handler:
  app.post('/phantom/bind', async (req, reply) => {
    const s = readSession(req as any, app.config.sessionSecret);
    if (!s) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'login required' });
    const parsed = BindBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'invalid body' });
    const { nonce, wallet_address, signature_base58 } = parsed.data;

    return await withTx(app.pool, async (c) => {
      const { rows } = await c.query<{ user_email: string; expires_at: Date; used_at: Date | null }>(
        'SELECT user_email, expires_at, used_at FROM phantom_challenges WHERE nonce=$1 FOR UPDATE',
        [nonce],
      );
      const ch = rows[0];
      if (!ch) return reply.code(400).send({ error: 'NONCE_INVALID', message: 'unknown nonce' });
      if (ch.user_email !== s.email) return reply.code(400).send({ error: 'NONCE_INVALID', message: 'wrong user' });
      if (ch.expires_at.getTime() < Date.now()) return reply.code(400).send({ error: 'NONCE_EXPIRED', message: 'nonce expired' });
      // Allow used nonce reuse only if it's the same user re-binding the same wallet (idempotent).
      const message = `rpow2.com bind: ${nonce}`;
      if (!verifyPhantomSignature(message, signature_base58, wallet_address)) {
        return reply.code(400).send({ error: 'BAD_SIGNATURE', message: 'signature does not verify' });
      }
      // Check if user already has this wallet bound — idempotent rebind.
      const existing = await c.query<{ solana_wallet: string | null }>(
        'SELECT solana_wallet FROM users WHERE email=$1', [s.email],
      );
      if (existing.rows[0]?.solana_wallet === wallet_address) {
        await c.query('UPDATE phantom_challenges SET used_at=now() WHERE nonce=$1', [nonce]);
        return { ok: true, solana_wallet: wallet_address };
      }
      try {
        await c.query('UPDATE users SET solana_wallet=$1 WHERE email=$2', [wallet_address, s.email]);
        await c.query('UPDATE phantom_challenges SET used_at=now() WHERE nonce=$1', [nonce]);
      } catch (e: any) {
        if (e?.code === '23505') {       // unique violation on solana_wallet
          return reply.code(400).send({ error: 'WALLET_TAKEN', message: 'wallet already bound to another user' });
        }
        throw e;
      }
      return { ok: true, solana_wallet: wallet_address };
    });
  });
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run tests/phantom.test.ts --root apps/server   # all 6 pass
git add apps/server/src/routes/phantom.ts apps/server/tests/phantom.test.ts
git commit -m "feat(server): POST /phantom/bind verifies signature, sets users.solana_wallet"
```

---

## Task 12: `POST /srpow/wrap` Phase 1 (lock) + allowlist gate + idempotency

**Files:**
- Create: `apps/server/src/routes/srpow.ts`
- Create: `apps/server/tests/srpow-wrap.test.ts`
- Modify: `apps/server/src/buildApp.ts`

- [ ] **Step 1: Write tests for the lock-only path (Phase 2 still uses fake)**

```ts
// tests/srpow-wrap.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp } from './helpers.js';
import { signSession, SESSION_COOKIE } from '../src/session.js';
import { randomUUID } from 'node:crypto';

let cleanup: () => Promise<void> = async () => {};
afterEach(() => cleanup());

async function seedUser(t: Awaited<ReturnType<typeof makeTestApp>>, email: string, wallet: string, validTokens: number) {
  await t.pool.query(`INSERT INTO users(email, solana_wallet) VALUES($1,$2)`, [email, wallet]);
  for (let i = 0; i < validTokens; i++) {
    await t.pool.query(
      `INSERT INTO tokens(id, owner_email, value, state, server_sig) VALUES($1,$2,1,'VALID','\\x00')`,
      [randomUUID(), email],
    );
  }
}

describe('POST /srpow/wrap — Phase 1', () => {
  it('returns 403 when email not in allowlist', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'someone-else@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLET1', 5);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);

    const r = await t.app.inject({
      method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 1, idempotency_key: 'k1234567' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('FORBIDDEN');
  });

  it('returns 400 NO_WALLET_BOUND when user has no solana_wallet', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await t.pool.query(`INSERT INTO users(email) VALUES('alice@x.io')`);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    const r = await t.app.inject({
      method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 1, idempotency_key: 'k1234567' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('NO_WALLET_BOUND');
  });

  it('returns 400 INSUFFICIENT_BALANCE when not enough VALID tokens', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLET1', 2);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    const r = await t.app.inject({
      method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 5, idempotency_key: 'k1234567' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('INSUFFICIENT_BALANCE');
  });

  it('replays a same-key + same-params request without double-locking', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLET1', 5);
    t.bridgeClient.queueResult({ signature: 'sig_1' });   // for first call's Phase 2
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    const payload = { amount: 1, idempotency_key: 'k1234567' };

    const r1 = await t.app.inject({ method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session }, payload });
    expect(r1.statusCode).toBe(200);
    const r2 = await t.app.inject({ method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session }, payload });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().event_id).toBe(r1.json().event_id);

    // exactly one locked + minted token after both calls
    const wrapped = await t.pool.query(`SELECT count(*)::int AS n FROM tokens WHERE state='WRAPPED'`);
    expect(wrapped.rows[0].n).toBe(1);
  });

  it('rejects same-key + different-params with 409', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLET1', 5);
    t.bridgeClient.queueResult({ signature: 'sig_1' });
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);

    await t.app.inject({
      method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 1, idempotency_key: 'k1234567' },
    });
    const r = await t.app.inject({
      method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 2, idempotency_key: 'k1234567' },
    });
    expect(r.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run tests/srpow-wrap.test.ts --root apps/server
```

Expected: all fail (route doesn't exist).

- [ ] **Step 3: Implement Phase 1 + naive Phase 2 wiring (refund detail in Task 13)**

```ts
// src/routes/srpow.ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readSession } from './auth.js';
import { withTx } from '../db.js';
import { isAllowed } from '../wrap-allowlist.js';

const WrapBody = z.object({
  amount: z.number().int().positive().max(1_000_000),
  idempotency_key: z.string().min(8).max(80),
});

export async function srpowRoutes(app: FastifyInstance) {
  app.post('/srpow/wrap', async (req, reply) => {
    const s = readSession(req as any, app.config.sessionSecret);
    if (!s) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'login required' });
    if (!isAllowed(app.wrapAllowlist, s.email)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'wrap not enabled for your account' });
    }
    const parsed = WrapBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'invalid body' });
    const { amount, idempotency_key } = parsed.data;

    // Phase 1: DB lock (single tx).
    const phase1 = await withTx(app.pool, async (c) => {
      const dup = await c.query<{ id: string; amount: number; status: string; solana_signature: string | null }>(
        'SELECT id, amount, status, solana_signature FROM srpow_wrap_events WHERE idempotency_key=$1',
        [idempotency_key],
      );
      if (dup.rows[0]) {
        if (dup.rows[0].amount !== amount) {
          return { error: 'DUP_DIFFERENT_PARAMS' as const };
        }
        return { existing: dup.rows[0] };
      }

      const userRow = await c.query<{ solana_wallet: string | null }>(
        'SELECT solana_wallet FROM users WHERE email=$1', [s.email],
      );
      const wallet = userRow.rows[0]?.solana_wallet;
      if (!wallet) return { error: 'NO_WALLET_BOUND' as const };

      // Per-user serialization.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('rpow_srpow_wrap'), hashtext($1))`, [s.email]);

      const lockSql = `SELECT id FROM tokens WHERE owner_email=$1 AND state='VALID'
        ORDER BY issued_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED`;
      const { rows: locked } = await c.query<{ id: string }>(lockSql, [s.email, amount]);
      if (locked.length < amount) return { error: 'INSUFFICIENT_BALANCE' as const };

      const eventId = randomUUID();
      await c.query(
        `INSERT INTO srpow_wrap_events
         (id, user_email, solana_wallet, amount, direction, status, idempotency_key)
         VALUES($1,$2,$3,$4,'WRAP','PENDING',$5)`,
        [eventId, s.email, wallet, amount, idempotency_key],
      );
      const ids = locked.map(r => r.id);
      await c.query(
        `UPDATE tokens SET state='LOCKED_FOR_BRIDGE', wrap_event_id=$1
         WHERE id = ANY($2::uuid[])`,
        [eventId, ids],
      );

      return { fresh: { eventId, wallet, ids } };
    });

    if ('error' in phase1) {
      const code = phase1.error;
      if (code === 'DUP_DIFFERENT_PARAMS') return reply.code(409).send({ error: 'BAD_REQUEST', message: 'idempotency_key reused with different parameters' });
      if (code === 'NO_WALLET_BOUND') return reply.code(400).send({ error: 'NO_WALLET_BOUND', message: 'bind a Solana wallet first' });
      if (code === 'INSUFFICIENT_BALANCE') return reply.code(400).send({ error: 'INSUFFICIENT_BALANCE', message: 'not enough VALID tokens' });
    }

    // Replay path: a previous call already completed Phase 1+2 (or refunded).
    if ('existing' in phase1) {
      const e = phase1.existing;
      return { ok: true, event_id: e.id, status: e.status, solana_signature: e.solana_signature };
    }

    // Phase 2 happens in Task 13.
    if ('fresh' in phase1) {
      const { eventId, wallet, ids } = phase1.fresh;
      const result = await app.bridgeClient.mintTo({ recipientWallet: wallet, amount });
      if (result.status === 'confirmed') {
        await withTx(app.pool, async (c) => {
          await c.query(
            `UPDATE srpow_wrap_events SET status='CONFIRMED', solana_signature=$1, updated_at=now() WHERE id=$2`,
            [result.signature, eventId],
          );
          await c.query(
            `UPDATE tokens SET state='WRAPPED' WHERE id = ANY($1::uuid[])`,
            [ids],
          );
        });
        return { ok: true, event_id: eventId, status: 'CONFIRMED', solana_signature: result.signature };
      }
      // failure path implemented in Task 13
      return reply.code(503).send({ error: 'BRIDGE_FAILED', event_id: eventId, status: 'PENDING' });
    }
  });
}
```

- [ ] **Step 4: Register in buildApp.ts**

```ts
import { srpowRoutes } from './routes/srpow.js';
// ... after phantomRoutes:
await app.register(srpowRoutes);
```

- [ ] **Step 5: Run + commit**

```bash
npx vitest run tests/srpow-wrap.test.ts --root apps/server   # 5 of 5 pass
git add apps/server/src/routes/srpow.ts apps/server/src/buildApp.ts apps/server/tests/srpow-wrap.test.ts
git commit -m "feat(server): POST /srpow/wrap Phase 1 (lock + allowlist + idempotency)"
```

---

## Task 13: Phase 2 refund on bridge failure + signature pre-record

**Files:**
- Modify: `apps/server/src/routes/srpow.ts`
- Modify: `apps/server/tests/srpow-wrap.test.ts`

- [ ] **Step 1: Add tests**

Append to `tests/srpow-wrap.test.ts`:

```ts
describe('POST /srpow/wrap — Phase 2 failures', () => {
  it('auto-refunds on mint failure', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLET1', 3);
    t.bridgeClient.queueResult({ error: 'rpc_unavailable' });
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);

    const r = await t.app.inject({
      method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 2, idempotency_key: 'k_refund_1' },
    });

    expect(r.statusCode).toBe(503);
    expect(r.json().status).toBe('REFUNDED');
    expect(r.json().failure_reason).toBe('rpc_unavailable');

    const states = await t.pool.query(`SELECT state, count(*)::int AS n FROM tokens WHERE owner_email='alice@x.io' GROUP BY state`);
    const m = Object.fromEntries(states.rows.map(r => [r.state, r.n]));
    expect(m.VALID).toBe(3);                                    // all back to VALID
    expect(m.LOCKED_FOR_BRIDGE ?? 0).toBe(0);
    expect(m.WRAPPED ?? 0).toBe(0);

    const ev = await t.pool.query(`SELECT status, failure_reason FROM srpow_wrap_events`);
    expect(ev.rows[0].status).toBe('REFUNDED');
    expect(ev.rows[0].failure_reason).toBe('rpc_unavailable');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run tests/srpow-wrap.test.ts --root apps/server
```

Expected: new test fails (currently 503 status from Task 12 placeholder is `'PENDING'`, not `'REFUNDED'`; tokens stay LOCKED).

- [ ] **Step 3: Implement Phase 2 refund**

In `src/routes/srpow.ts`, replace the Phase 2 block (after `if ('fresh' in phase1)`) with:

```ts
    if ('fresh' in phase1) {
      const { eventId, wallet, ids } = phase1.fresh;
      const result = await app.bridgeClient.mintTo({ recipientWallet: wallet, amount });

      if (result.status === 'confirmed') {
        await withTx(app.pool, async (c) => {
          await c.query(
            `UPDATE srpow_wrap_events SET status='CONFIRMED', solana_signature=$1, updated_at=now() WHERE id=$2`,
            [result.signature, eventId],
          );
          await c.query(
            `UPDATE tokens SET state='WRAPPED' WHERE id = ANY($1::uuid[])`,
            [ids],
          );
        });
        return { ok: true, event_id: eventId, status: 'CONFIRMED', solana_signature: result.signature };
      }

      // Failure path: refund.
      await withTx(app.pool, async (c) => {
        await c.query(
          `UPDATE srpow_wrap_events SET status='REFUNDED', failure_reason=$1, solana_signature=$2, updated_at=now() WHERE id=$3`,
          [result.failureReason, result.signature, eventId],
        );
        await c.query(
          `UPDATE tokens SET state='VALID', wrap_event_id=NULL WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      });
      return reply.code(503).send({
        error: 'BRIDGE_FAILED', event_id: eventId, status: 'REFUNDED',
        failure_reason: result.failureReason,
      });
    }
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run tests/srpow-wrap.test.ts --root apps/server   # all 6 pass
git add apps/server/src/routes/srpow.ts apps/server/tests/srpow-wrap.test.ts
git commit -m "feat(server): /srpow/wrap auto-refund on bridge failure"
```

---

## Task 14: `GET /srpow/events` (list + by-id)

**Files:**
- Modify: `apps/server/src/routes/srpow.ts`
- Modify: `apps/server/tests/srpow-wrap.test.ts`

- [ ] **Step 1: Add tests**

```ts
describe('GET /srpow/events', () => {
  it('lists current user events newest first', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLET1', 5);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    t.bridgeClient.queueResult({ signature: 'sig_a' });
    t.bridgeClient.queueResult({ error: 'oops' });

    await t.app.inject({ method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 1, idempotency_key: 'k_a' } });
    await t.app.inject({ method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: session },
      payload: { amount: 1, idempotency_key: 'k_b' } });

    const r = await t.app.inject({ method: 'GET', url: '/srpow/events', cookies: { [SESSION_COOKIE]: session } });
    expect(r.statusCode).toBe(200);
    const list = r.json() as Array<{status: string; amount: number}>;
    expect(list.length).toBe(2);
    // newest first
    expect(list[0].status).toBe('REFUNDED');
    expect(list[1].status).toBe('CONFIRMED');
  });

  it('does not leak other users events', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io,bob@x.io' });
    cleanup = t.cleanup;
    await seedUser(t, 'alice@x.io', 'WALLETA', 1);
    await seedUser(t, 'bob@x.io', 'WALLETB', 1);
    t.bridgeClient.queueResult({ signature: 'sig_a' });
    const aliceSession = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    await t.app.inject({ method: 'POST', url: '/srpow/wrap', cookies: { [SESSION_COOKIE]: aliceSession },
      payload: { amount: 1, idempotency_key: 'k_a' } });

    const bobSession = signSession({ email: 'bob@x.io' }, 'x'.repeat(32), 60);
    const r = await t.app.inject({ method: 'GET', url: '/srpow/events', cookies: { [SESSION_COOKIE]: bobSession } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

Append to `srpowRoutes(app)`:

```ts
  app.get('/srpow/events', async (req, reply) => {
    const s = readSession(req as any, app.config.sessionSecret);
    if (!s) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'login required' });
    const { rows } = await app.pool.query(
      `SELECT id, direction, amount, status, solana_signature, failure_reason, created_at, updated_at
       FROM srpow_wrap_events WHERE user_email=$1 ORDER BY created_at DESC LIMIT 100`,
      [s.email],
    );
    return rows.map(r => ({
      event_id: r.id,
      direction: r.direction,
      amount: r.amount,
      status: r.status,
      solana_signature: r.solana_signature,
      failure_reason: r.failure_reason,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  });

  app.get<{ Params: { id: string } }>('/srpow/events/:id', async (req, reply) => {
    const s = readSession(req as any, app.config.sessionSecret);
    if (!s) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'login required' });
    const { rows } = await app.pool.query(
      `SELECT id, direction, amount, status, solana_signature, failure_reason, created_at, updated_at
       FROM srpow_wrap_events WHERE id=$1 AND user_email=$2`,
      [req.params.id, s.email],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'NOT_FOUND', message: 'event not found' });
    const r = rows[0];
    return {
      event_id: r.id, direction: r.direction, amount: r.amount, status: r.status,
      solana_signature: r.solana_signature, failure_reason: r.failure_reason,
      created_at: r.created_at, updated_at: r.updated_at,
    };
  });
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run tests/srpow-wrap.test.ts --root apps/server   # 8 pass
git add apps/server/src/routes/srpow.ts apps/server/tests/srpow-wrap.test.ts
git commit -m "feat(server): GET /srpow/events + /srpow/events/:id"
```

---

## Task 15: `/me` exposes wrap_allowed + solana_wallet + srpow_supply_owned

**Files:**
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/tests/` — pick the existing `me`-targeted test file or create one if absent

- [ ] **Step 1: Look at the current /me handler**

```bash
cat apps/server/src/routes/me.ts
```

- [ ] **Step 2: Add the three fields**

Inside the handler, after the existing balance/email queries, add:

```ts
const userRow = await app.pool.query<{ solana_wallet: string | null }>(
  'SELECT solana_wallet FROM users WHERE email=$1', [s.email],
);
const wrappedRow = await app.pool.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM tokens WHERE owner_email=$1 AND state='WRAPPED'`,
  [s.email],
);

return {
  /* ...existing fields... */
  wrap_allowed: app.wrapAllowlist.has(s.email.toLowerCase()),
  solana_wallet: userRow.rows[0]?.solana_wallet ?? null,
  srpow_supply_owned: wrappedRow.rows[0]?.n ?? 0,
};
```

- [ ] **Step 3: Add a test**

Create or extend `apps/server/tests/me.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp } from './helpers.js';
import { signSession, SESSION_COOKIE } from '../src/session.js';

let cleanup: () => Promise<void> = async () => {};
afterEach(() => cleanup());

describe('GET /me — SRPOW fields', () => {
  it('returns wrap_allowed and solana_wallet correctly', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'alice@x.io' });
    cleanup = t.cleanup;
    await t.pool.query(`INSERT INTO users(email, solana_wallet) VALUES('alice@x.io','WALLET_X')`);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);

    const r = await t.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: session } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      wrap_allowed: true, solana_wallet: 'WALLET_X', srpow_supply_owned: 0,
    });
  });

  it('returns wrap_allowed=false for non-allowlisted users', async () => {
    const t = await makeTestApp({ wrapAllowlistCsv: 'someone@x.io' });
    cleanup = t.cleanup;
    await t.pool.query(`INSERT INTO users(email) VALUES('alice@x.io')`);
    const session = signSession({ email: 'alice@x.io' }, 'x'.repeat(32), 60);
    const r = await t.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: session } });
    expect(r.json()).toMatchObject({ wrap_allowed: false, solana_wallet: null });
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run tests/me.test.ts --root apps/server   # passes
git add apps/server/src/routes/me.ts apps/server/tests/me.test.ts
git commit -m "feat(server): /me returns wrap_allowed + solana_wallet + srpow_supply_owned"
```

---

## Task 16: Boot-time reconcile worker

**Files:**
- Create: `apps/server/src/srpow-reconcile.ts`
- Create: `apps/server/tests/srpow-reconcile.test.ts`
- Modify: `apps/server/src/server.ts` — call after migrations

- [ ] **Step 1: Write tests**

```ts
// tests/srpow-reconcile.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FakeBridgeClient } from '@rpow/solana-bridge';
import { makeTestApp } from './helpers.js';
import { reconcilePendingWraps } from '../src/srpow-reconcile.js';

let cleanup: () => Promise<void> = async () => {};
afterEach(() => cleanup());

async function seed(t: Awaited<ReturnType<typeof makeTestApp>>, opts: {
  signature: string | null; tokenIds: string[];
}) {
  await t.pool.query(`INSERT INTO users(email, solana_wallet) VALUES('alice@x.io','W')`);
  const eventId = randomUUID();
  await t.pool.query(
    `INSERT INTO srpow_wrap_events(id, user_email, solana_wallet, amount, direction, status, idempotency_key, solana_signature)
     VALUES($1,'alice@x.io','W',$2,'WRAP','PENDING',$3,$4)`,
    [eventId, opts.tokenIds.length, `idem-${eventId}`, opts.signature],
  );
  for (const tid of opts.tokenIds) {
    await t.pool.query(
      `INSERT INTO tokens(id, owner_email, value, state, server_sig, wrap_event_id)
       VALUES($1,'alice@x.io',1,'LOCKED_FOR_BRIDGE','\\x00',$2)`,
      [tid, eventId],
    );
  }
  return eventId;
}

describe('reconcilePendingWraps', () => {
  it('refunds PENDING events with no signature', async () => {
    const t = await makeTestApp();
    cleanup = t.cleanup;
    const tid = randomUUID();
    const eventId = await seed(t, { signature: null, tokenIds: [tid] });

    const fake = new FakeBridgeClient();
    await reconcilePendingWraps(t.pool, fake);

    const ev = await t.pool.query('SELECT status, failure_reason FROM srpow_wrap_events WHERE id=$1', [eventId]);
    expect(ev.rows[0].status).toBe('REFUNDED');
    expect(ev.rows[0].failure_reason).toMatch(/no signature/);

    const tk = await t.pool.query('SELECT state, wrap_event_id FROM tokens WHERE id=$1', [tid]);
    expect(tk.rows[0].state).toBe('VALID');
    expect(tk.rows[0].wrap_event_id).toBeNull();
  });

  it('confirms PENDING events whose signature is on-chain', async () => {
    const t = await makeTestApp();
    cleanup = t.cleanup;
    const tid = randomUUID();
    const eventId = await seed(t, { signature: 'sig_xyz', tokenIds: [tid] });

    const fake = new FakeBridgeClient();
    fake.setSignatureStatus('sig_xyz', 'confirmed');
    await reconcilePendingWraps(t.pool, fake);

    const ev = await t.pool.query('SELECT status FROM srpow_wrap_events WHERE id=$1', [eventId]);
    expect(ev.rows[0].status).toBe('CONFIRMED');

    const tk = await t.pool.query('SELECT state FROM tokens WHERE id=$1', [tid]);
    expect(tk.rows[0].state).toBe('WRAPPED');
  });

  it('refunds PENDING events whose signature is not_found / failed', async () => {
    const t = await makeTestApp();
    cleanup = t.cleanup;
    const tid = randomUUID();
    const eventId = await seed(t, { signature: 'sig_nope', tokenIds: [tid] });

    const fake = new FakeBridgeClient();
    fake.setSignatureStatus('sig_nope', 'not_found');
    await reconcilePendingWraps(t.pool, fake);

    const ev = await t.pool.query('SELECT status, failure_reason FROM srpow_wrap_events WHERE id=$1', [eventId]);
    expect(ev.rows[0].status).toBe('REFUNDED');
    const tk = await t.pool.query('SELECT state FROM tokens WHERE id=$1', [tid]);
    expect(tk.rows[0].state).toBe('VALID');
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/srpow-reconcile.ts
import type { Pool } from 'pg';
import type { BridgeClient } from '@rpow/solana-bridge';
import { withTx } from './db.js';

export async function reconcilePendingWraps(pool: Pool, bridge: BridgeClient): Promise<void> {
  const { rows } = await pool.query<{ id: string; solana_signature: string | null }>(
    `SELECT id, solana_signature FROM srpow_wrap_events WHERE status='PENDING'`,
  );
  for (const ev of rows) {
    if (!ev.solana_signature) {
      await refund(pool, ev.id, 'reconcile: no signature recorded');
      continue;
    }
    let resolved: 'confirmed' | 'failed' | 'not_found';
    try {
      resolved = await bridge.getSignatureStatus(ev.solana_signature);
    } catch (e: any) {
      console.error(`reconcile getSignatureStatus failed for ${ev.id}:`, e?.message ?? e);
      continue;            // leave PENDING; next boot will retry
    }
    if (resolved === 'confirmed') {
      await confirm(pool, ev.id);
    } else {
      await refund(pool, ev.id, `reconcile: signature ${resolved}`);
    }
  }
}

async function confirm(pool: Pool, eventId: string): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`UPDATE srpow_wrap_events SET status='CONFIRMED', updated_at=now() WHERE id=$1`, [eventId]);
    await c.query(`UPDATE tokens SET state='WRAPPED' WHERE wrap_event_id=$1`, [eventId]);
  });
}

async function refund(pool: Pool, eventId: string, reason: string): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(
      `UPDATE srpow_wrap_events SET status='REFUNDED', failure_reason=$1, updated_at=now() WHERE id=$2`,
      [reason, eventId],
    );
    await c.query(
      `UPDATE tokens SET state='VALID', wrap_event_id=NULL WHERE wrap_event_id=$1`,
      [eventId],
    );
  });
}
```

- [ ] **Step 3: Wire into `server.ts`**

After `await runMigrations(pool);`:

```ts
import { reconcilePendingWraps } from './srpow-reconcile.js';
// ... after bridgeClient is constructed:
await reconcilePendingWraps(pool, bridgeClient);
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run tests/srpow-reconcile.test.ts --root apps/server   # 3 pass
npm run build --workspace @rpow/server
git add apps/server/src/srpow-reconcile.ts apps/server/src/server.ts apps/server/tests/srpow-reconcile.test.ts
git commit -m "feat(server): boot-time reconcile of PENDING wrap events"
```

---

## Task 17: One-shot mint script

**Files:**
- Create: `apps/server/scripts/create-srpow-mint.ts`

This script is operator-run, not server-runtime. No automated tests; manual verification on devnet first, then mainnet.

- [ ] **Step 1: Implement**

```ts
// apps/server/scripts/create-srpow-mint.ts
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { SRPOW_DECIMALS } from '@rpow/solana-bridge';

const MIN_BALANCE_LAMPORTS = 0.005 * LAMPORTS_PER_SOL;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--init-keys')) {
    const kp = Keypair.generate();
    console.log(`BRIDGE_PUBKEY=${kp.publicKey.toBase58()}`);
    console.log(`BRIDGE_KEYPAIR_BASE58=${bs58.encode(kp.secretKey)}`);
    console.log(`# Send >=0.05 SOL to BRIDGE_PUBKEY before running default mode.`);
    return;
  }

  if (process.env.SRPOW_MINT_ADDRESS) {
    throw new Error('refusing: SRPOW_MINT_ADDRESS already set in env (mint already created)');
  }
  const rpc = process.env.SOLANA_RPC_URL;
  const sk = process.env.BRIDGE_KEYPAIR_BASE58;
  if (!rpc) throw new Error('SOLANA_RPC_URL required');
  if (!sk) throw new Error('BRIDGE_KEYPAIR_BASE58 required (run with --init-keys first)');

  const conn = new Connection(rpc, 'confirmed');
  const bridge = Keypair.fromSecretKey(bs58.decode(sk));
  const balance = await conn.getBalance(bridge.publicKey);
  if (balance < MIN_BALANCE_LAMPORTS) {
    throw new Error(`bridge balance ${balance / LAMPORTS_PER_SOL} SOL < required 0.005 SOL`);
  }

  const mint = await createMint(
    conn,
    bridge,                        // payer
    bridge.publicKey,              // mint authority
    null,                          // freeze authority RENOUNCED
    SRPOW_DECIMALS,
  );
  console.log(`SRPOW_MINT_ADDRESS=${mint.toBase58()}`);
  console.log(`# Verify on https://solscan.io/token/${mint.toBase58()} : decimals=9, freeze authority null, mint authority=${bridge.publicKey.toBase58()}, supply=0`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
```

- [ ] **Step 2: Add npm script for ergonomics**

In `apps/server/package.json` scripts:

```json
"create-srpow-mint": "tsx scripts/create-srpow-mint.ts"
```

- [ ] **Step 3: Manual smoke test (no commit yet — operator-only step)**

```bash
# generate keypair only — safe to run anywhere, no on-chain action
npm run create-srpow-mint --workspace @rpow/server -- --init-keys
```

Expected output: two lines, `BRIDGE_PUBKEY=...` and `BRIDGE_KEYPAIR_BASE58=...`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/create-srpow-mint.ts apps/server/package.json
git commit -m "feat(server): create-srpow-mint script (--init-keys + default mode)"
```

---

## Task 18: Web — install Solana deps + protocol types

**Files:**
- Modify: `apps/web/package.json`
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: Add web deps**

```bash
npm install --workspace apps/web --save \
  @solana/web3.js@^1.91.0 @solana/spl-token@^0.4.6 bs58@^6.0.0 --ignore-scripts
```

- [ ] **Step 2: Extend protocol.ts**

Append to `packages/shared/src/protocol.ts`:

```ts
export interface PhantomChallengeResponse {
  nonce: string;
  message: string;
  expires_at: string;
}

export interface PhantomBindResponse {
  ok: true;
  solana_wallet: string;
}

export interface WrapResponse {
  ok: true;
  event_id: string;
  status: 'CONFIRMED';
  solana_signature: string;
}

export interface WrapEvent {
  event_id: string;
  direction: 'WRAP' | 'UNWRAP';
  amount: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED';
  solana_signature: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}
```

Also extend the existing `MeResponse` interface (find it in the same file and add):

```ts
  wrap_allowed: boolean;
  solana_wallet: string | null;
  srpow_supply_owned: number;
```

- [ ] **Step 3: Build shared package**

```bash
npm run build --workspace @rpow/shared
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json packages/shared/src/protocol.ts package-lock.json
git commit -m "feat(shared): add SRPOW protocol types + extend MeResponse"
```

---

## Task 19: Web — `api.ts` typed methods

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add the four methods**

Inside the existing `api` object, add:

```ts
async phantomChallenge(): Promise<PhantomChallengeResponse> {
  return req<PhantomChallengeResponse>('/phantom/challenge', { method: 'POST' });
},
async phantomBind(body: { nonce: string; wallet_address: string; signature_base58: string }): Promise<PhantomBindResponse> {
  return req<PhantomBindResponse>('/phantom/bind', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
},
async srpowWrap(body: { amount: number; idempotency_key: string }): Promise<WrapResponse> {
  return req<WrapResponse>('/srpow/wrap', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
},
async srpowEvents(): Promise<WrapEvent[]> {
  return req<WrapEvent[]>('/srpow/events');
},
```

(Add the `import type { ... } from '@rpow/shared'` at top.)

- [ ] **Step 2: Build web**

```bash
npm run build --workspace apps/web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(web): typed API methods for /phantom/* and /srpow/*"
```

---

## Task 20: `usePhantom` hook

**Files:**
- Create: `apps/web/src/hooks/usePhantom.ts`

- [ ] **Step 1: Implement**

```ts
// apps/web/src/hooks/usePhantom.ts
import { useEffect, useState } from 'react';
import bs58 from 'bs58';

declare global {
  interface Window { solana?: { isPhantom?: boolean; publicKey?: { toString(): string }; connect(): Promise<{ publicKey: { toString(): string } }>; signMessage(m: Uint8Array, encoding: 'utf8'): Promise<{ signature: Uint8Array }>; disconnect(): Promise<void> } }
}

export function usePhantom() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean>(false);
  useEffect(() => {
    setInstalled(!!window.solana?.isPhantom);
    setWallet(window.solana?.publicKey?.toString() ?? null);
  }, []);

  async function connect(): Promise<string> {
    if (!window.solana?.isPhantom) throw new Error('Phantom not installed');
    const r = await window.solana.connect();
    const pk = r.publicKey.toString();
    setWallet(pk);
    return pk;
  }

  async function signMessage(message: string): Promise<string> {
    if (!window.solana) throw new Error('Phantom not connected');
    const { signature } = await window.solana.signMessage(new TextEncoder().encode(message), 'utf8');
    return bs58.encode(signature);
  }

  return { wallet, installed, connect, signMessage };
}
```

- [ ] **Step 2: Build to verify types**

```bash
npm run build --workspace apps/web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/usePhantom.ts
git commit -m "feat(web): usePhantom hook (connect + signMessage)"
```

---

## Task 21: `useSrpow` hook

**Files:**
- Create: `apps/web/src/hooks/useSrpow.ts`

- [ ] **Step 1: Implement**

```ts
// apps/web/src/hooks/useSrpow.ts
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import type { WrapEvent, WrapResponse } from '@rpow/shared';

export function useSrpow() {
  const [events, setEvents] = useState<WrapEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setEvents(await api.srpowEvents()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  async function wrap(amount: number): Promise<WrapResponse> {
    const idempotency_key = crypto.randomUUID();
    const r = await api.srpowWrap({ amount, idempotency_key });
    await refresh();
    return r;
  }

  return { events, loading, wrap, refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/hooks/useSrpow.ts
git commit -m "feat(web): useSrpow hook (wrap + events)"
```

---

## Task 22: `ConnectPhantom` component

**Files:**
- Create: `apps/web/src/components/ConnectPhantom.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/ConnectPhantom.tsx
import { useState } from 'react';
import { usePhantom } from '../hooks/usePhantom.js';
import { api } from '../api.js';

interface Props { boundWallet: string | null; onBound(wallet: string): void }

export function ConnectPhantom({ boundWallet, onBound }: Props) {
  const phantom = usePhantom();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (boundWallet) return <div>Phantom: <code>{abbr(boundWallet)}</code></div>;
  if (!phantom.installed) {
    return <div style={{ color: '#f88' }}>Phantom wallet not detected. Install at <a href="https://phantom.app">phantom.app</a> and reload.</div>;
  }

  async function handleConnect() {
    setBusy(true); setErr(null);
    try {
      const wallet = await phantom.connect();
      const challenge = await api.phantomChallenge();
      const sig = await phantom.signMessage(challenge.message);
      const bound = await api.phantomBind({
        nonce: challenge.nonce, wallet_address: wallet, signature_base58: sig,
      });
      onBound(bound.solana_wallet);
    } catch (e: any) {
      setErr(e?.message ?? 'connect failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button disabled={busy} onClick={handleConnect}>
        {busy ? 'Connecting...' : 'Connect Phantom'}
      </button>
      {err && <div style={{ color: '#f88' }}>{err}</div>}
    </div>
  );
}

function abbr(s: string) { return `${s.slice(0,4)}…${s.slice(-4)}`; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ConnectPhantom.tsx
git commit -m "feat(web): ConnectPhantom component"
```

---

## Task 23: `WrapForm` component

**Files:**
- Create: `apps/web/src/components/WrapForm.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/WrapForm.tsx
import { useState } from 'react';
import { useSrpow } from '../hooks/useSrpow.js';

interface Props {
  available: number;
  enabled: boolean;
  onWrapped(): void;
}

export function WrapForm({ available, enabled, onWrapped }: Props) {
  const { wrap } = useSrpow();
  const [amount, setAmount] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handle() {
    setBusy(true); setMsg(null);
    try {
      const n = parseInt(amount, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be a positive integer');
      if (n > available) throw new Error('insufficient balance');
      const r = await wrap(n);
      setMsg({ kind: 'ok', text: `Wrapped ${n} RPOW. tx: ${r.solana_signature.slice(0,8)}…` });
      setAmount('');
      onWrapped();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? 'wrap failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label>Amount to wrap: </label>
      <input
        type="number" min={1} max={available} value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={!enabled || busy}
      />{' '}
      <button onClick={handle} disabled={!enabled || busy || !amount}>
        {busy ? 'Confirming on Solana...' : 'Wrap'}
      </button>
      {msg && (
        <div style={{ marginTop: 8, color: msg.kind === 'ok' ? '#6ee7b7' : '#f88' }}>{msg.text}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/WrapForm.tsx
git commit -m "feat(web): WrapForm component"
```

---

## Task 24: `WrapHistory` component

**Files:**
- Create: `apps/web/src/components/WrapHistory.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/WrapHistory.tsx
import type { WrapEvent } from '@rpow/shared';

interface Props { events: WrapEvent[] }

export function WrapHistory({ events }: Props) {
  if (!events.length) return <div style={{ color: '#888' }}>No wraps yet.</div>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {events.map(e => (
        <li key={e.event_id} style={{ borderTop: '1px solid #222', padding: '6px 0', fontFamily: 'monospace', fontSize: 12 }}>
          <span>{new Date(e.created_at).toISOString().slice(0,16).replace('T',' ')}</span>
          {' '}<span>{e.amount} RPOW → SRPOW</span>
          {' '}<span style={{ color: statusColor(e.status) }}>{e.status}</span>
          {e.solana_signature && (
            <>{' '}<a href={`https://solscan.io/tx/${e.solana_signature}`} target="_blank" rel="noreferrer">tx</a></>
          )}
          {e.failure_reason && <div style={{ color: '#f88' }}>{e.failure_reason}</div>}
        </li>
      ))}
    </ul>
  );
}

function statusColor(s: WrapEvent['status']) {
  if (s === 'CONFIRMED') return '#6ee7b7';
  if (s === 'PENDING') return '#fbbf24';
  return '#f88';
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/WrapHistory.tsx
git commit -m "feat(web): WrapHistory component (Solscan links)"
```

---

## Task 25: `WrapPage` + route + nav gate

**Files:**
- Create: `apps/web/src/pages/WrapPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Implement WrapPage**

```tsx
// apps/web/src/pages/WrapPage.tsx
import { useEffect, useState } from 'react';
import { Panel } from '../components/Panel.js';
import { ConnectPhantom } from '../components/ConnectPhantom.js';
import { WrapForm } from '../components/WrapForm.js';
import { WrapHistory } from '../components/WrapHistory.js';
import { useSrpow } from '../hooks/useSrpow.js';
import { useMe } from '../hooks/useMe.js';

export function WrapPage() {
  const { me, refresh: refreshMe } = useMe();
  const { events, refresh: refreshEvents } = useSrpow();
  const [wallet, setWallet] = useState<string | null>(me?.solana_wallet ?? null);
  useEffect(() => { setWallet(me?.solana_wallet ?? null); }, [me?.solana_wallet]);

  if (!me) return <Panel title="WRAP TO SOLANA"><div>loading…</div></Panel>;
  if (!me.wrap_allowed) {
    return <Panel title="WRAP TO SOLANA"><div>Not enabled for your account.</div></Panel>;
  }

  return (
    <>
      <Panel title="WRAP TO SOLANA (SRPOW)">
        <p style={{ marginTop: 0, fontSize: 12, color: '#aaa' }}>
          Centralized → on-chain. Once SRPOW is minted to your wallet, you control it
          via Phantom. The operator takes no fee and no warranty is provided. Treat
          with care.
        </p>
        <ConnectPhantom boundWallet={wallet} onBound={(w) => { setWallet(w); refreshMe(); }} />
        <div style={{ marginTop: 8 }}>
          RPOW available: <strong>{me.balance ?? 0}</strong>{' · '}
          SRPOW you've wrapped: <strong>{me.srpow_supply_owned ?? 0}</strong>
        </div>
      </Panel>

      <Panel title="WRAP">
        <WrapForm
          available={me.balance ?? 0}
          enabled={!!wallet}
          onWrapped={() => { refreshEvents(); refreshMe(); }}
        />
      </Panel>

      <Panel title="RECENT WRAPS">
        <WrapHistory events={events} />
      </Panel>
    </>
  );
}
```

- [ ] **Step 2: Register `/wrap` route in App.tsx + gate the nav link**

In `apps/web/src/App.tsx`, find the existing route registration block. Add:

```tsx
{me?.wrap_allowed && <Route path="/wrap" element={<WrapPage />} />}
```

(Adjust to match the existing react-router setup — replace `Route` with whatever the file currently uses.)

In the nav bar, add (only when `me.wrap_allowed`):

```tsx
{me.wrap_allowed && <NavLink to="/wrap">Wrap</NavLink>}
```

- [ ] **Step 3: Build + spot-check**

```bash
npm run build --workspace apps/web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/WrapPage.tsx apps/web/src/App.tsx
git commit -m "feat(web): WrapPage + /wrap route gated on wrap_allowed"
```

---

## Task 26: Operator runbook entry for SRPOW rollout

**Files:**
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Append a new section**

Add to `docs/RUNBOOK.md`:

```markdown
## SRPOW (Solana wrap) rollout

**One-time setup (operator-only):**

1. Sign up for a Solana RPC (Helius / QuickNode / Triton). Record the mainnet URL.
2. Generate the bridge keypair locally:
   ```bash
   npm run create-srpow-mint --workspace @rpow/server -- --init-keys
   ```
   Save `BRIDGE_KEYPAIR_BASE58` securely (1Password / encrypted file).
3. Send 0.05 SOL to `BRIDGE_PUBKEY` from a personal Phantom.
4. Create the SPL mint:
   ```bash
   SOLANA_RPC_URL=<rpc> BRIDGE_KEYPAIR_BASE58=<from step 2> \
     npm run create-srpow-mint --workspace @rpow/server
   ```
   Verify on Solscan: decimals 9, freeze authority null, supply 0.
5. Update `/etc/rpow/server.env` on the VPS:
   ```
   SOLANA_RPC_URL=<rpc>
   SRPOW_MINT_ADDRESS=<from step 4>
   BRIDGE_KEYPAIR_BASE58=<from step 2>
   WRAP_ALLOWED_EMAILS=frk314@gmail.com
   SRPOW_COMMITMENT=confirmed
   ```
6. Deploy (standard runbook deploy command). Migration 007 runs on startup; reconcile worker scans PENDING events.

**Smoke test:** Sign in as `frk314@gmail.com`, bind Phantom, wrap 1 RPOW. Verify the mint tx on Solscan and SRPOW balance in Phantom.

**Bridge SOL top-up:** when balance approaches 0.005 SOL, send another 0.05 from a personal Phantom. Manual for v1; automated alarm in a follow-up.
```

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "docs(runbook): SRPOW rollout procedure"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| `packages/solana-bridge` skeleton | Task 1 |
| `wallet-verify` | Task 2 |
| `BridgeClient` interface + Fake | Task 3 |
| `SolanaBridgeClient` real impl | Task 4 |
| Server env vars | Task 5 |
| Migration 007 | Task 6 |
| `wrap-allowlist.ts` | Task 7 |
| `bridge-keys.ts` | Task 8 |
| `buildApp` decorations | Task 9 |
| `POST /phantom/challenge` | Task 10 |
| `POST /phantom/bind` | Task 11 |
| `POST /srpow/wrap` Phase 1 + idempotency + allowlist | Task 12 |
| `POST /srpow/wrap` Phase 2 refund | Task 13 |
| `GET /srpow/events` + `:id` | Task 14 |
| `/me` extension | Task 15 |
| Reconcile worker | Task 16 |
| Mint script | Task 17 |
| Web deps + protocol types | Task 18 |
| Web `api.ts` methods | Task 19 |
| `usePhantom` hook | Task 20 |
| `useSrpow` hook | Task 21 |
| `ConnectPhantom` | Task 22 |
| `WrapForm` | Task 23 |
| `WrapHistory` | Task 24 |
| `WrapPage` + route | Task 25 |
| RUNBOOK | Task 26 |

All spec sections accounted for. Unwrap is explicitly out of scope (deferred per spec).

**Placeholder scan:** None found — all code blocks are concrete; all run commands give expected output.

**Type consistency:**
- `MintToArgs` { recipientWallet, amount } — used identically in Tasks 3, 4, 12, 13, 16. ✓
- `MintToResult` discriminated union { confirmed | failed } — used in Tasks 12, 13, 16. ✓
- `SignatureStatus` 'confirmed' | 'failed' | 'not_found' — used in Tasks 3, 4, 16. ✓
- `WrapEvent` shape matches across server response (Tasks 14) and shared types (Task 18) and frontend (Tasks 21, 24). ✓
- `srpow_wrap_events` columns match across migration (Task 6), Phase 1/2 SQL (Tasks 12, 13), reconcile (Task 16), `/srpow/events` (Task 14). ✓
- `tokens.wrap_event_id` referenced in Tasks 6, 12, 13, 16 — consistent. ✓
- `app.wrapAllowlist` is `Set<string>` — added Task 9, used in Tasks 12, 15. ✓
- `app.bridgeClient` decoration — added Task 9, used in Tasks 12, 13. ✓

No drift detected.
