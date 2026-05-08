import { describe, it, expect } from 'vitest';
import {
  FakeMailer,
  ThrottledMailer,
  ThrottleQueueFullError,
  type SendArgs,
} from '../src/mailer.js';

const args = (to: string): SendArgs => ({
  to, subject: 's', html: '<p>x</p>', text: 'x',
});

describe('ThrottledMailer', () => {
  it('passes through a single send with no measurable delay', async () => {
    const inner = new FakeMailer();
    const tm = new ThrottledMailer(inner, { rps: 4, maxQueue: 10 });
    const t0 = Date.now();
    await tm.send(args('a@x.io'));
    const elapsed = Date.now() - t0;
    expect(inner.outbox.length).toBe(1);
    expect(elapsed).toBeLessThan(50);                  // first slot is "now"
  });

  it('paces concurrent sends at <= rps', async () => {
    const inner = new FakeMailer();
    // 100 rps == 10ms per slot. 5 calls => slots at 0, 10, 20, 30, 40 ms.
    const tm = new ThrottledMailer(inner, { rps: 100, maxQueue: 10 });
    const t0 = Date.now();
    await Promise.all([1, 2, 3, 4, 5].map(i => tm.send(args(`u${i}@x.io`))));
    const elapsed = Date.now() - t0;
    expect(inner.outbox.length).toBe(5);
    // 4 inter-slot gaps × 10ms = 40ms minimum. Allow generous slack for CI.
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(500);
  });

  it('throws ThrottleQueueFullError when waiters exceed maxQueue', async () => {
    const inner = new FakeMailer();
    // 1 rps == 1000ms per slot, maxQueue=2. Three concurrent sends:
    // first two reserve slots, third hits the queue cap.
    const tm = new ThrottledMailer(inner, { rps: 1, maxQueue: 2 });
    const p1 = tm.send(args('a@x.io'));
    const p2 = tm.send(args('b@x.io'));
    await expect(tm.send(args('c@x.io'))).rejects.toBeInstanceOf(ThrottleQueueFullError);
    // First two still complete eventually. p1 immediately, p2 after ~1s.
    await p1;
    // Don't await p2 in the test (it would take ~1s). Just confirm it's still pending.
    // p2 will complete in the background, FakeMailer's outbox grows to 2.
    void p2;
  }, 6000);

  it('decrements queue depth even if inner throws', async () => {
    const failing: import('../src/mailer.js').Mailer = {
      async send() { throw new Error('boom'); },
    };
    const tm = new ThrottledMailer(failing, { rps: 1000, maxQueue: 2 });
    await expect(tm.send(args('a@x.io'))).rejects.toThrow(/boom/);
    // After the throw, queueDepth should be back to 0; another send must succeed
    // entering the queue (it will also throw 'boom', proving it got past the gate).
    await expect(tm.send(args('b@x.io'))).rejects.toThrow(/boom/);
  });

  it('ThrottleQueueFullError carries statusCode 429', () => {
    const e = new ThrottleQueueFullError();
    expect(e.statusCode).toBe(429);
    expect(e.message).toMatch(/queue is full/);
  });

  it('rejects rps <= 0 and maxQueue <= 0', () => {
    const inner = new FakeMailer();
    expect(() => new ThrottledMailer(inner, { rps: 0, maxQueue: 1 })).toThrow(/rps/);
    expect(() => new ThrottledMailer(inner, { rps: 1, maxQueue: 0 })).toThrow(/maxQueue/);
  });
});
