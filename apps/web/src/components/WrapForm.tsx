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
      setMsg({ kind: 'ok', text: `Wrapped ${n} RPOW. tx: ${r.solana_signature.slice(0, 8)}…` });
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
        type="number"
        min={1}
        max={available}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={!enabled || busy}
      />{' '}
      <button onClick={handle} disabled={!enabled || busy || !amount}>
        {busy ? 'Confirming on Solana…' : 'Wrap'}
      </button>
      {msg && (
        <div style={{ marginTop: 8, color: msg.kind === 'ok' ? '#6ee7b7' : '#f88' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
