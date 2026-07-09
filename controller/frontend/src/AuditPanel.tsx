import { useCallback, useEffect, useState } from 'react';
import { api, AuditLogEntry } from './api';

const PAGE_SIZE = 50;

export default function AuditPanel({ onError }: { onError: (msg: string) => void }) {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [actor, setActor] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getAuditLog({
        entity_type: entityType || undefined,
        actor: actor || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) { onError((err as Error).message); }
  }, [entityType, actor, offset, onError]);

  useEffect(() => { void load(); }, [load]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    void load();
  }

  return (
    <div className="panel">
      <h2>Audit Log <span className="count">({total})</span></h2>

      <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input placeholder="entity type (e.g. group)" value={entityType} onChange={e => setEntityType(e.target.value)} style={{ flex: 1 }} />
        <input placeholder="actor email contains…" value={actor} onChange={e => setActor(e.target.value)} style={{ flex: 1 }} />
        <button className="ghost" type="submit">Search</button>
      </form>

      {rows.length === 0 ? (
        <div className="empty-state">No audit entries match.</div>
      ) : (
        rows.map(r => (
          <div className="session-row-wrap" key={r.id}>
            <div className="session-row">
              <div>
                <div className="session-circuit">
                  <button className="disclosure" onClick={() => setExpanded(x => x === r.id ? null : r.id)} aria-label="Toggle details">
                    {expanded === r.id ? '▾' : '▸'}
                  </button>
                  {r.actor ?? 'system'} · {r.action} · {r.entity_type}
                </div>
                <div className="session-ts">{new Date(r.event_time).toLocaleString()}</div>
              </div>
              <span className="jack-kind">{r.entity_type}</span>
            </div>
            {expanded === r.id && (
              <div className="participants">
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>entity_id: {r.entity_id}</div>
                {r.source_ip && <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>source_ip: {r.source_ip}</div>}
                {r.metadata && (
                  <pre style={{ fontSize: 11, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.metadata, null, 2)}</pre>
                )}
                {r.before_state && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>before:</div>
                    <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.before_state, null, 2)}</pre>
                  </>
                )}
                {r.after_state && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>after:</div>
                    <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.after_state, null, 2)}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12 }}>
          <button className="ghost" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}>← Newer</button>
          <span style={{ color: 'var(--text-dim)' }}>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <button className="ghost" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)}>Older →</button>
        </div>
      )}
    </div>
  );
}
