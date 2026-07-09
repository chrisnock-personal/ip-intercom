import { useCallback, useEffect, useRef, useState } from 'react';
import { api, BackupInfo, DbStats } from './api';

export default function DatabasePanel({ onError }: { onError: (msg: string) => void }) {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [stats, setStats] = useState<DbStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [purgeTable, setPurgeTable] = useState<'audit_log' | 'intercom_sessions'>('audit_log');
  const [purgeDays, setPurgeDays] = useState(90);
  const [archiveDays, setArchiveDays] = useState(90);
  const [transferType, setTransferType] = useState<'local' | 'scp' | 'none'>('none');
  const [transferPath, setTransferPath] = useState('');
  const [transferHost, setTransferHost] = useState('');
  const [transferUser, setTransferUser] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([api.getBackupInfo(), api.getDbStats()]);
      setInfo(i); setStats(s);
    } catch (err) { onError((err as Error).message); }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  async function runBackup() {
    setBusy('backup'); setMessage(null);
    try { await api.downloadBackup(); setMessage('Backup downloaded.'); }
    catch (err) { onError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function runRestore(file: File) {
    if (!window.confirm(`Restore from "${file.name}"? This applies directly against the live database and cannot be undone.`)) return;
    setBusy('restore'); setMessage(null);
    try {
      const text = await file.text();
      const res = await api.restoreBackup(text);
      setMessage(res.message);
      await load();
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(null); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  async function runVacuum() {
    setBusy('vacuum'); setMessage(null);
    try { const res = await api.runVacuum(); setMessage(res.message); await load(); }
    catch (err) { onError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function runPurge() {
    if (!window.confirm(`Delete ${purgeTable} rows older than ${purgeDays} days? This cannot be undone.`)) return;
    setBusy('purge'); setMessage(null);
    try { const res = await api.purgeTable(purgeTable, purgeDays); setMessage(res.message + ` (${res.deleted} rows)`); await load(); }
    catch (err) { onError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function runArchive() {
    setBusy('archive'); setMessage(null);
    try {
      const transfer = transferType === 'none' ? undefined
        : transferType === 'local' ? { type: 'local' as const, path: transferPath }
        : { type: 'scp' as const, host: transferHost, user: transferUser, path: transferPath };
      const res = await api.archiveTables(archiveDays, transfer);
      setMessage(`Archive "${res.archive_name}" created (${(res.size_bytes / 1024).toFixed(1)} KB). ${res.transfer}`);
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="panel">
      <h2>Database &amp; Backup</h2>

      {message && <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 14 }}>{message}</div>}

      {info && (
        <div className="metrics-row" style={{ marginBottom: 16 }}>
          <div className="metric">
            <div className="metric-value">{info.db_size}</div>
            <div className="metric-label">DB Size</div>
          </div>
          <div className="metric">
            <div className="metric-value">{info.counts.sessions}</div>
            <div className="metric-label">Sessions</div>
          </div>
          <div className="metric">
            <div className="metric-value">{info.counts.audit_log}</div>
            <div className="metric-label">Audit Rows</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className="primary" disabled={busy === 'backup'} onClick={runBackup}>
          {busy === 'backup' ? 'Creating backup…' : '⬇ Download backup'}
        </button>
        <button className="ghost" disabled={busy === 'restore'} onClick={() => fileInputRef.current?.click()}>
          {busy === 'restore' ? 'Restoring…' : '⬆ Restore from file'}
        </button>
        <input ref={fileInputRef} type="file" accept=".sql" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void runRestore(f); }} />
      </div>

      <h2>Maintenance</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className="ghost" disabled={busy === 'vacuum'} onClick={runVacuum}>
          {busy === 'vacuum' ? 'Running…' : 'VACUUM ANALYZE'}
        </button>
      </div>

      <h2>Retention / Purge</h2>
      <div className="field">
        <label>Table</label>
        <select value={purgeTable} onChange={e => setPurgeTable(e.target.value as 'audit_log' | 'intercom_sessions')}>
          <option value="audit_log">audit_log</option>
          <option value="intercom_sessions">intercom_sessions (never touches active calls)</option>
        </select>
      </div>
      <div className="field">
        <label>Delete rows older than (days, min 30)</label>
        <input type="number" min={30} value={purgeDays} onChange={e => setPurgeDays(parseInt(e.target.value) || 30)} />
      </div>
      <button className="danger" disabled={busy === 'purge'} onClick={runPurge} style={{ marginBottom: 20 }}>
        {busy === 'purge' ? 'Purging…' : 'Purge old rows'}
      </button>

      <h2>Archive &amp; Remote Transfer</h2>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        Dumps audit_log + intercom_sessions (+ participants) to a compressed archive, optionally pushed to a remote host.
      </div>
      <div className="field">
        <label>Archive rows older than (days)</label>
        <input type="number" min={1} value={archiveDays} onChange={e => setArchiveDays(parseInt(e.target.value) || 90)} />
      </div>
      <div className="field">
        <label>Transfer</label>
        <select value={transferType} onChange={e => setTransferType(e.target.value as 'local' | 'scp' | 'none')}>
          <option value="none">None — just create the archive</option>
          <option value="local">Copy to local/mounted path</option>
          <option value="scp">SCP to remote host</option>
        </select>
      </div>
      {transferType !== 'none' && (
        <>
          {transferType === 'scp' && (
            <>
              <div className="field"><label>Host</label><input value={transferHost} onChange={e => setTransferHost(e.target.value)} /></div>
              <div className="field"><label>User</label><input value={transferUser} onChange={e => setTransferUser(e.target.value)} /></div>
            </>
          )}
          <div className="field"><label>Destination path</label><input value={transferPath} onChange={e => setTransferPath(e.target.value)} placeholder="/path/to/dest/" /></div>
        </>
      )}
      <button className="ghost" disabled={busy === 'archive'} onClick={runArchive} style={{ marginBottom: 20 }}>
        {busy === 'archive' ? 'Archiving…' : 'Create archive'}
      </button>

      {stats && (
        <>
          <h2>Table Stats</h2>
          {stats.tables.map(t => (
            <div className="session-row" key={t.table}>
              <div>
                <div className="session-circuit">{t.table}</div>
                <div className="session-ts">{t.rows} rows · {t.dead_rows} dead</div>
              </div>
              <span className="jack-latency">{t.size}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
