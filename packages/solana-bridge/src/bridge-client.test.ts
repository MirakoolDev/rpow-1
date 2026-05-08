import { describe, it, expect } from 'vitest';
import { FakeBridgeClient } from './bridge-client.js';

describe('FakeBridgeClient', () => {
  it('mintTo returns the queued signature and records the call', async () => {
    const c = new FakeBridgeClient();
    c.queueResult({ signature: 'fake_sig_1' });
    const r = await c.mintTo({ recipientWallet: 'WALLET1', amountBaseUnits: 3_000_000_000n });
    expect(r.status).toBe('confirmed');
    expect(r.signature).toBe('fake_sig_1');
    expect(c.calls).toEqual([{ recipientWallet: 'WALLET1', amountBaseUnits: 3_000_000_000n }]);
  });

  it('queues a failure result', async () => {
    const c = new FakeBridgeClient();
    c.queueResult({ error: 'rpc_unavailable' });
    const r = await c.mintTo({ recipientWallet: 'WALLET1', amountBaseUnits: 1_000_000_000n });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') throw new Error('expected failed');
    expect(r.failureReason).toBe('rpc_unavailable');
  });

  it('throws if no result queued', async () => {
    const c = new FakeBridgeClient();
    await expect(c.mintTo({ recipientWallet: 'W', amountBaseUnits: 1_000_000_000n })).rejects.toThrow(/no result queued/);
  });

  it('getSignatureStatus returns queued status', async () => {
    const c = new FakeBridgeClient();
    c.setSignatureStatus('sig_x', 'confirmed');
    expect(await c.getSignatureStatus('sig_x')).toBe('confirmed');
    expect(await c.getSignatureStatus('unknown')).toBe('not_found');
  });
});
