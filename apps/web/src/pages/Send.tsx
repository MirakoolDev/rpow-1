import { useState } from 'react';
import { Panel } from '../components/Panel.js';
import { api } from '../api.js';
import { useMe } from '../hooks/useMe.js';

export function SendPage() {
  const { me, refresh } = useMe();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState(1);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [transferId, setTransferId] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setStatus('sending'); setError('');
    try {
      const r = await api.send({ recipient_email: recipient, amount, idempotency_key: crypto.randomUUID() });
      setStatus('sent'); setTransferId(r.transfer_id);
      await refresh();
    } catch (err: any) {
      setStatus('error');
      const code = err?.error ?? 'INTERNAL';
      const msgs: Record<string, string> = {
        RECIPIENT_NOT_FOUND: 'recipient has no rpow2 account',
        INSUFFICIENT_BALANCE: 'not enough tokens in your wallet',
        BAD_REQUEST: err?.message ?? 'bad request',
      };
      setError(msgs[code] ?? code);
    }
  }

  if (!me) return <Panel title="SEND"><div>not signed in.</div></Panel>;

  return (
    <Panel title="SEND">
      <form onSubmit={submit}>
        <div>TO     : <input type="email" required value={recipient} onChange={e => setRecipient(e.target.value)} style={{ width: '40ch' }} /></div>
        <div style={{ marginTop: 4 }}>AMOUNT : <input type="number" min={1} max={me.balance} required value={amount} onChange={e => setAmount(Number(e.target.value))} style={{ width: '10ch' }} /> RPOW</div>
        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={status === 'sending'}>[ {status === 'sending' ? '...' : 'SEND'} ]</button>
        </div>
      </form>
      {status === 'sent' && <div style={{ marginTop: 8 }}>+ sent. transfer id: {transferId}</div>}
      {status === 'error' && <div className="error" style={{ marginTop: 8 }}>error: {error}</div>}
    </Panel>
  );
}
