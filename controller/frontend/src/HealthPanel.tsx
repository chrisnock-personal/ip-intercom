import { useCallback, useEffect, useState } from 'react';
import { api, SystemHealth, ContainerLogs } from './api';

const SERVICES = ['pbx-core', 'controller-backend', 'controller-frontend', 'rtpengine', 'freeswitch', 'postgres'] as const;

function PctBar({ pct }: { pct: number }) {
  const color = pct >= 85 ? 'var(--red)' : pct >= 65 ? 'var(--amber)' : 'var(--green)';
  return (
    <div className="pct-bar">
      <div className="pct-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function HealthPanel({ onError }: { onError: (msg: string) => void }) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [service, setService] = useState<(typeof SERVICES)[number]>('pbx-core');
  const [logs, setLogs] = useState<ContainerLogs | null>(null);
  const [logTab, setLogTab] = useState<'all' | 'errors'>('all');
  const [logsLoading, setLogsLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    try { setHealth(await api.getSystemHealth()); }
    catch (err) { onError((err as Error).message); }
  }, [onError]);

  const loadLogs = useCallback(async (svc: string) => {
    setLogsLoading(true);
    try { setLogs(await api.getContainerLogs(svc, 200)); }
    catch (err) { onError((err as Error).message); }
    finally { setLogsLoading(false); }
  }, [onError]);

  useEffect(() => { void loadHealth(); }, [loadHealth]);
  useEffect(() => { void loadLogs(service); }, [service, loadLogs]);
  useEffect(() => {
    const t = setInterval(() => void loadHealth(), 30_000);
    return () => clearInterval(t);
  }, [loadHealth]);

  return (
    <div className="panel">
      <h2>System Health</h2>
      {!health ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <>
          <div className="metrics-row">
            <div className="metric">
              <div className="metric-value">{health.system.cpu_pct}%</div>
              <div className="metric-label">CPU</div>
              <PctBar pct={health.system.cpu_pct} />
            </div>
            <div className="metric">
              <div className="metric-value">{health.system.mem_used_pct}%</div>
              <div className="metric-label">Memory</div>
              <PctBar pct={health.system.mem_used_pct} />
            </div>
            <div className="metric">
              <div className="metric-value">{health.system.disk_used_pct}%</div>
              <div className="metric-label">Disk</div>
              <PctBar pct={health.system.disk_used_pct} />
            </div>
          </div>

          <div className="metrics-row" style={{ marginTop: 12 }}>
            <div className="metric">
              <div className="metric-value">{health.backend.uptime_human}</div>
              <div className="metric-label">Backend Uptime</div>
            </div>
            <div className="metric">
              <div className="metric-value">{health.database.size}</div>
              <div className="metric-label">DB Size</div>
            </div>
            <div className={`metric ${health.pbx_core.reachable ? 'direct' : ''}`}>
              <div className="metric-value" style={{ color: health.pbx_core.reachable ? 'var(--green)' : 'var(--red)' }}>
                {health.pbx_core.reachable ? 'UP' : 'DOWN'}
              </div>
              <div className="metric-label">pbx-core</div>
            </div>
          </div>

          {health.pbx_core.reachable && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
              {health.pbx_core.registrations} registered · {health.pbx_core.calls} active calls
            </div>
          )}
          {!health.pbx_core.reachable && (
            <div className="error-banner" style={{ marginTop: 10 }}>pbx-core unreachable: {health.pbx_core.error}</div>
          )}

          <h2 style={{ marginTop: 20 }}>Endpoints</h2>
          {health.endpoints.length === 0 ? (
            <div className="empty-state">No enabled endpoints.</div>
          ) : (
            health.endpoints.map(ep => (
              <div className="session-row" key={ep.id}>
                <div>
                  <div className="session-circuit">{ep.name}</div>
                  <div className="session-ts">{ep.aor}</div>
                </div>
                <span className={`session-state ${ep.status === 'online' ? 'active' : 'failed'}`}>{ep.status}</span>
              </div>
            ))
          )}

          <h2 style={{ marginTop: 20 }}>Table Sizes</h2>
          {health.database.table_sizes.map(t => (
            <div className="session-row" key={t.table}>
              <div className="session-circuit">{t.table}</div>
              <span className="session-ts">{t.size} · {t.rows} rows</span>
            </div>
          ))}

          <h2 style={{ marginTop: 20 }}>Container Logs</h2>
          <div className="nav-tabs" style={{ padding: 0, background: 'none', border: 'none', marginBottom: 10 }}>
            {SERVICES.map(s => (
              <button key={s} className={`nav-tab${service === s ? ' active' : ''}`} onClick={() => setService(s)}>{s}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className={logTab === 'all' ? 'primary tiny' : 'ghost tiny'} onClick={() => setLogTab('all')}>All lines</button>
            <button className={logTab === 'errors' ? 'primary tiny' : 'ghost tiny'} onClick={() => setLogTab('errors')}>Errors/warnings only</button>
            <button className="ghost tiny" disabled={logsLoading} onClick={() => void loadLogs(service)}>↻ Refresh</button>
          </div>
          <div className="log-viewer">
            {logsLoading ? 'Loading…' : (logTab === 'errors' ? logs?.errors : logs?.lines)?.join('\n') || 'No log lines.'}
          </div>
        </>
      )}
    </div>
  );
}
