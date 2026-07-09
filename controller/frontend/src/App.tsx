import { useEffect, useState, useCallback } from 'react';
import {
  api, Endpoint, Group, GroupMember, SessionUser,
  DirectoryUser, DirectoryUserButton, LiveRegistration, LiveCall,
} from './api';
import HealthPanel from './HealthPanel';
import AuditPanel from './AuditPanel';
import DatabasePanel from './DatabasePanel';

// ── Login ──────────────────────────────────────────────────────────────────
function Login({ onLoggedIn }: { onLoggedIn: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('admin@intercom.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(email, password);
      onLoggedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>Intercom Console</h1>
        <div className="sub">Sign in to control endpoints and sessions</div>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
        </div>
        <div className="field">
          <label>Password</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" required />
        </div>
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ── Live: registrations + in-progress calls (polled straight from pbx-core's
// own in-memory state — see controller-backend's pbxCoreService.ts) ─────────
function RegisteredTurretsPanel({ registrations }: { registrations: LiveRegistration[] }) {
  return (
    <div className="panel">
      <h2>Registered Turrets <span className="count">({registrations.length})</span></h2>
      {registrations.length === 0 ? (
        <div className="empty-state">No turrets currently registered.</div>
      ) : (
        <div className="patchbay">
          {registrations.map(r => {
            const secsLeft = Math.max(0, Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 1000));
            return (
              <div key={r.extension} className="jack">
                <span className="jack-led online" />
                <div className="jack-name">{r.name ?? r.extension}</div>
                <div className="jack-aor">ext {r.extension} · {r.transport}</div>
                <span className="jack-kind">{r.mediaMode}</span>
                <div className="jack-latency">expires in {secsLeft}s</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CallMetricsPanel({ calls }: { calls: LiveCall[] }) {
  const direct = calls.filter(c => c.kind === 'direct').length;
  const group = calls.filter(c => c.kind === 'group').length;
  return (
    <div className="panel">
      <h2>Call Metrics</h2>
      <div className="metrics-row">
        <div className="metric">
          <div className="metric-value">{calls.length}</div>
          <div className="metric-label">Total</div>
        </div>
        <div className="metric direct">
          <div className="metric-value">{direct}</div>
          <div className="metric-label">ICM</div>
        </div>
        <div className="metric group">
          <div className="metric-value">{group}</div>
          <div className="metric-label">GRP-ICM</div>
        </div>
      </div>
    </div>
  );
}

function ActiveCallsPanel({ calls }: { calls: LiveCall[] }) {
  return (
    <div className="panel">
      <h2>Active Calls <span className="count">({calls.length})</span></h2>
      {calls.length === 0 ? (
        <div className="empty-state">No calls in progress.</div>
      ) : (
        calls.map(c => (
          <div className="session-row" key={c.callId}>
            <div>
              <div className="session-circuit">
                {c.kind === 'direct'
                  ? `${c.fromName} (${c.from}) → ${c.toName} (${c.to})`
                  : `${c.fromName} (${c.from}) ⚡ ${c.toName} (${c.to})`}
              </div>
              <div className="session-ts">{new Date(c.startedAt).toLocaleTimeString()}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`call-type ${c.kind}`}>{c.kind === 'direct' ? 'ICM' : 'GRP-ICM'}</span>
              <span className="session-state active">live</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Groups (open-mic / PTT) ──────────────────────────────────────────────────
function GroupsPanel({
  endpoints, onError, onSessionsChanged,
}: {
  endpoints: Endpoint[];
  onError: (msg: string) => void;
  onSessionsChanged: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<'talkback' | 'announce'>('talkback');
  const [newPttDefault, setNewPttDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit-form state for the currently-selected group — synced below
  // whenever `selected` changes, same pattern as refreshMembers.
  const [editName, setEditName] = useState('');
  const [editMode, setEditMode] = useState<'talkback' | 'announce'>('talkback');
  const [editPttDefault, setEditPttDefault] = useState(false);

  const refreshGroups = useCallback(async () => {
    try { setGroups(await api.listGroups()); } catch (err) { onError((err as Error).message); }
  }, [onError]);

  const refreshMembers = useCallback(async (groupId: string) => {
    try { setMembers(await api.listGroupMembers(groupId)); } catch (err) { onError((err as Error).message); }
  }, [onError]);

  useEffect(() => { void refreshGroups(); }, [refreshGroups]);
  useEffect(() => { if (selected) void refreshMembers(selected); }, [selected, refreshMembers]);
  useEffect(() => {
    const g = groups.find((x) => x.id === selected);
    if (g) {
      setEditName(g.name);
      setEditMode(g.mode);
      setEditPttDefault(g.ptt_default);
    }
  }, [selected, groups]);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const g = await api.createGroup({ name: newName.trim(), mode: newMode, ptt_default: newPttDefault });
      setNewName('');
      setNewPttDefault(false);
      await refreshGroups();
      setSelected(g.id);
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleMember(endpointId: string, inGroup: boolean) {
    if (!selected) return;
    try {
      if (inGroup) await api.removeGroupMember(selected, endpointId);
      else await api.addGroupMember(selected, endpointId);
      await refreshMembers(selected);
    } catch (err) { onError((err as Error).message); }
  }

  async function start() {
    if (!selected) return;
    setBusy(true);
    try { await api.startGroup(selected); onSessionsChanged(); }
    catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function saveGroup() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.updateGroup(selected, { name: editName.trim(), mode: editMode, ptt_default: editPttDefault });
      await refreshGroups();
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function deleteGroup() {
    if (!selected) return;
    const g = groups.find((x) => x.id === selected);
    if (!window.confirm(`Delete group "${g?.name}"? Any directory-user buttons pointing at it will be removed too.`)) return;
    setBusy(true);
    try {
      await api.deleteGroup(selected);
      setSelected(null);
      await refreshGroups();
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  const group = groups.find(g => g.id === selected);
  const memberIds = new Set(members.map(m => m.endpoint_id));

  return (
    <div className="panel">
      <h2>Groups <span className="count">({groups.length})</span></h2>

      <form onSubmit={createGroup} style={{ marginBottom: 16 }}>
        <div className="field">
          <label>New group name</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Floor A" />
        </div>
        <div className="field">
          <label>Mode</label>
          <select value={newMode} onChange={e => setNewMode(e.target.value as 'talkback' | 'announce')}>
            <option value="talkback">Talkback (everyone can talk)</option>
            <option value="announce">Announce (one-way paging)</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '8px 0' }}>
          <input type="checkbox" checked={newPttDefault} onChange={e => setNewPttDefault(e.target.checked)} />
          PTT default (members start muted — push to talk — instead of open mic)
        </label>
        <button className="ghost" type="submit" disabled={busy}>Create group</button>
      </form>

      {groups.length === 0 ? (
        <div className="empty-state">No groups yet — create one above.</div>
      ) : (
        <>
          <div className="field">
            <label>Select group</label>
            <select value={selected ?? ''} onChange={e => setSelected(e.target.value || null)}>
              <option value="">— choose —</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name} (*8{g.dial_code}){g.ptt_default ? ' — PTT' : ''}</option>
              ))}
            </select>
          </div>

          {group && (
            <>
              <div className="field">
                <label>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="field">
                <label>Mode</label>
                <select value={editMode} onChange={e => setEditMode(e.target.value as 'talkback' | 'announce')}>
                  <option value="talkback">Talkback (everyone can talk)</option>
                  <option value="announce">Announce (one-way paging)</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '8px 0' }}>
                <input type="checkbox" checked={editPttDefault} onChange={e => setEditPttDefault(e.target.checked)} />
                PTT default (members start muted — push to talk — instead of open mic)
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button className="ghost" disabled={busy || !editName.trim()} onClick={saveGroup}>Save changes</button>
                <button className="link" disabled={busy} onClick={deleteGroup}>Delete group</button>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                Members can talk by default; uncheck for listen-only.
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 12 }}>
                {endpoints.map(ep => {
                  const inGroup = memberIds.has(ep.id);
                  return (
                    <label key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                      <input type="checkbox" checked={inGroup} onChange={() => toggleMember(ep.id, inGroup)} />
                      <span style={{ fontFamily: 'var(--mono)' }}>{ep.name}</span>
                    </label>
                  );
                })}
              </div>
              <button className="primary" disabled={busy || members.filter(m => m.can_talk).length === 0} onClick={start}>
                {busy ? 'Starting…' : `Start "${group.name}"`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Directory users (turret login + button assignments) ──────────────────────
function DirectoryUsersPanel({ onError }: { onError: (msg: string) => void }) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [buttons, setButtons] = useState<DirectoryUserButton[]>([]);
  const [newName, setNewName] = useState('');
  const [newExtension, setNewExtension] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [directTarget, setDirectTarget] = useState('');
  const [groupTarget, setGroupTarget] = useState('');
  const [busy, setBusy] = useState(false);

  // Edit-form state for the currently-selected user — synced below
  // whenever `selected` changes.
  const [editName, setEditName] = useState('');
  const [editExtension, setEditExtension] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);

  const refreshUsers = useCallback(async () => {
    try { setUsers(await api.listDirectoryUsers()); } catch (err) { onError((err as Error).message); }
  }, [onError]);

  const refreshButtons = useCallback(async (id: string) => {
    try { setButtons(await api.listDirectoryUserButtons(id)); } catch (err) { onError((err as Error).message); }
  }, [onError]);

  useEffect(() => { void refreshUsers(); }, [refreshUsers]);
  useEffect(() => { api.listGroups().then(setGroups).catch((err) => onError((err as Error).message)); }, [onError]);
  useEffect(() => { if (selected) void refreshButtons(selected); }, [selected, refreshButtons]);
  useEffect(() => {
    const u = users.find((x) => x.id === selected);
    if (u) {
      setEditName(u.name);
      setEditExtension(u.extension);
      setEditEnabled(u.enabled);
    }
  }, [selected, users]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newExtension.trim() || !newPassword) return;
    setBusy(true);
    try {
      const u = await api.createDirectoryUser({ name: newName.trim(), extension: newExtension.trim(), password: newPassword });
      setNewName(''); setNewExtension(''); setNewPassword('');
      await refreshUsers();
      setSelected(u.id);
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function addDirectButton() {
    if (!selected || !directTarget.trim()) return;
    try {
      await api.addDirectoryUserButton(selected, { button_type: 'direct', target_extension: directTarget.trim() });
      setDirectTarget('');
      await refreshButtons(selected);
    } catch (err) { onError((err as Error).message); }
  }

  async function addGroupButton() {
    if (!selected || !groupTarget) return;
    try {
      await api.addDirectoryUserButton(selected, { button_type: 'group', target_group_id: groupTarget });
      setGroupTarget('');
      await refreshButtons(selected);
    } catch (err) { onError((err as Error).message); }
  }

  async function removeButton(buttonId: string) {
    if (!selected) return;
    try { await api.removeDirectoryUserButton(selected, buttonId); await refreshButtons(selected); }
    catch (err) { onError((err as Error).message); }
  }

  async function saveUser() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.updateDirectoryUser(selected, { name: editName.trim(), extension: editExtension.trim(), enabled: editEnabled });
      await refreshUsers();
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function deleteUser() {
    if (!selected) return;
    const u = users.find((x) => x.id === selected);
    if (!window.confirm(`Delete directory user "${u?.name}"? Their buttons will be removed too.`)) return;
    setBusy(true);
    try {
      await api.deleteDirectoryUser(selected);
      setSelected(null);
      await refreshUsers();
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }

  const user = users.find(u => u.id === selected);

  return (
    <div className="panel">
      <h2>Directory Users <span className="count">({users.length})</span></h2>

      <form onSubmit={createUser} style={{ marginBottom: 16 }}>
        <div className="field">
          <label>Name</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Alice Chen" />
        </div>
        <div className="field">
          <label>Extension</label>
          <input value={newExtension} onChange={e => setNewExtension(e.target.value)} placeholder="e.g. 2001" />
        </div>
        <div className="field">
          <label>Turret login password</label>
          <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" />
        </div>
        <button className="ghost" type="submit" disabled={busy}>Create directory user</button>
      </form>

      {users.length === 0 ? (
        <div className="empty-state">No directory users yet — create one above.</div>
      ) : (
        <>
          <div className="field">
            <label>Select user</label>
            <select value={selected ?? ''} onChange={e => setSelected(e.target.value || null)}>
              <option value="">— choose —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} (ext {u.extension})</option>)}
            </select>
          </div>

          {user && (
            <>
              <div className="field">
                <label>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="field">
                <label>Extension</label>
                <input value={editExtension} onChange={e => setEditExtension(e.target.value)} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '8px 0' }}>
                <input type="checkbox" checked={editEnabled} onChange={e => setEditEnabled(e.target.checked)} />
                Enabled (can log in and register from the turret)
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button className="ghost" disabled={busy || !editName.trim() || !editExtension.trim()} onClick={saveUser}>Save changes</button>
                <button className="link" disabled={busy} onClick={deleteUser}>Delete user</button>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                Buttons {user.name} sees on their turret. They pick Handset A/B/Speaker
                on the turret itself when pressing one — not fixed here.
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                {buttons.length === 0 ? (
                  <div className="empty-state" style={{ margin: '6px 0' }}>No buttons assigned.</div>
                ) : buttons.map(b => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                    <span style={{ fontFamily: 'var(--mono)' }}>
                      {b.button_type === 'direct' ? `→ ${b.target_extension}` : `⚡ ${b.target_group_name}`}
                    </span>
                    <button className="link" onClick={() => removeButton(b.id)}>remove</button>
                  </div>
                ))}
              </div>

              <div className="field">
                <label>Add direct button (target extension)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={directTarget} onChange={e => setDirectTarget(e.target.value)} placeholder="e.g. 1002" style={{ flex: 1 }} />
                  <button className="ghost" onClick={addDirectButton}>Add</button>
                </div>
              </div>

              <div className="field">
                <label>Add group button</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={groupTarget} onChange={e => setGroupTarget(e.target.value)} style={{ flex: 1 }}>
                    <option value="">— choose group —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button className="ghost" onClick={addGroupButton}>Add</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── App shell ────────────────────────────────────────────────────────────────
type View = 'live' | 'groups' | 'directory-users' | 'health' | 'audit' | 'database';
const NAV_ITEMS: { id: View; label: string; adminOnly?: boolean }[] = [
  { id: 'live', label: 'Live' },
  { id: 'groups', label: 'Groups' },
  { id: 'directory-users', label: 'Directory Users' },
  { id: 'health', label: 'Health', adminOnly: true },
  { id: 'audit', label: 'Audit', adminOnly: true },
  { id: 'database', label: 'Database', adminOnly: true },
];

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [registrations, setRegistrations] = useState<LiveRegistration[]>([]);
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('live');

  const refresh = useCallback(async () => {
    try {
      const [eps, live] = await Promise.all([api.listEndpoints(), api.getLiveStatus()]);
      setEndpoints(eps);
      setRegistrations(live.registrations);
      setCalls(live.calls);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!api.isLoggedIn()) { setCheckedSession(true); return; }
    api.me().then(setUser).catch(() => {}).finally(() => setCheckedSession(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [user, refresh]);

  if (!checkedSession) return null;

  if (!user) {
    return (
      <div className="app-shell">
        <Login onLoggedIn={setUser} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-led" />
          <span className="brand-title">Intercom Console</span>
          <span className="brand-sub">groups, directory users &amp; endpoints</span>
        </div>
        <div className="topbar-right">
          <span className="role-chip">{user.role}</span>
          <span>{user.email}</span>
          <button className="link" onClick={() => { void api.logout(); setUser(null); }}>Sign out</button>
        </div>
      </div>

      <nav className="nav-tabs">
        {NAV_ITEMS.filter(item => !item.adminOnly || user.role === 'admin').map(item => (
          <button
            key={item.id}
            className={`nav-tab${view === item.id ? ' active' : ''}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="layout">
        {error && <div className="error-banner">{error}</div>}

        {view === 'live' && (
          <>
            <RegisteredTurretsPanel registrations={registrations} />
            <CallMetricsPanel calls={calls} />
            <ActiveCallsPanel calls={calls} />
          </>
        )}

        {view === 'groups' && (
          <GroupsPanel
            endpoints={endpoints}
            onError={setError}
            onSessionsChanged={() => { setError(null); void refresh(); }}
          />
        )}

        {view === 'directory-users' && <DirectoryUsersPanel onError={setError} />}

        {view === 'health' && <HealthPanel onError={setError} />}
        {view === 'audit' && <AuditPanel onError={setError} />}
        {view === 'database' && <DatabasePanel onError={setError} />}
      </main>
    </div>
  );
}
