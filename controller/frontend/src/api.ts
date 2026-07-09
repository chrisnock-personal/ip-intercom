// src/api.ts — thin fetch wrapper for the intercom controller API.
const BASE = '/api/v1';

export interface SessionUser {
  id: string;
  email: string;
  role: string;
}

export interface Endpoint {
  id: string;
  name: string;
  aor: string;
  rest_url: string | null;
  kind: 'station' | 'announcer' | 'tap' | 'handset';
  enabled: boolean;
  status: 'online' | 'offline' | 'unknown';
  last_seen_at: string | null;
  last_error: string | null;
  last_latency_ms: number | null;
}

export interface IntercomSession {
  id: string;
  kind: 'direct' | 'group';
  state: 'active' | 'ended' | 'failed';
  initiator_name: string | null;
  target_name: string | null;
  group_name: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  mode: 'talkback' | 'announce';
  ptt_default: boolean;
  dial_code: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  endpoint_id: string;
  endpoint_name: string;
  rest_url: string | null;
  role: 'member' | 'announcer';
  can_talk: boolean;
}

export interface SessionParticipant {
  endpoint_id: string;
  endpoint_name: string;
  muted: boolean;
  joined_at: string;
  left_at: string | null;
}

export interface DirectoryUser {
  id: string;
  name: string;
  extension: string;
  enabled: boolean;
}

export interface SystemHealth {
  timestamp: string;
  backend: { uptime_seconds: number; uptime_human: string; memory_mb: number; memory_total_mb: number; node_version: string };
  host: { hostname: string; platform: string; arch: string };
  system: {
    cpu_pct: number; cpu_count: number;
    mem_used_mb: number; mem_total_mb: number; mem_free_mb: number; mem_used_pct: number;
    disk_used_mb: number; disk_total_mb: number; disk_free_mb: number; disk_used_pct: number;
  };
  endpoints: { id: string; name: string; aor: string; status: string; last_seen_at: string | null; last_error: string | null; last_latency_ms: number | null }[];
  pbx_core: { reachable: boolean; registrations?: number; calls?: number; error?: string };
  database: {
    size: string; active_queries: number;
    table_sizes: { table: string; size: string; rows: number }[];
  };
}

export interface AuditLogEntry {
  id: number;
  event_time: string;
  actor: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  source_ip: string | null;
}

export interface ContainerLogs {
  lines: string[];
  errors: string[];
  service: string;
}

export interface BackupInfo {
  db_size: string;
  counts: { endpoints: number; groups: number; directory_users: number; sessions: number; audit_log: number };
}

export interface DbStatsTable {
  table: string;
  size: string;
  size_bytes: number;
  rows: number;
  dead_rows: number;
  last_vacuum: string | null;
  last_autovacuum: string | null;
  last_analyze: string | null;
}

export interface DbStats {
  tables: DbStatsTable[];
  db_size: string;
  db_size_bytes: number;
}

export interface LiveRegistration {
  extension: string;
  name: string | null;
  transport: string;
  mediaMode: 'plain' | 'webrtc';
  expiresAt: string;
}

export interface LiveCall {
  callId: string;
  kind: 'direct' | 'group';
  from: string;
  fromName: string;
  to: string;
  toName: string;
  startedAt: string;
}

export interface DirectoryUserButton {
  id: string;
  directory_user_id: string;
  button_type: 'direct' | 'group';
  target_extension: string | null;
  target_group_id: string | null;
  target_group_name: string | null;
  target_group_dial_code: string | null;
  label: string | null;
  sort_order: number;
}

let token: string | null = localStorage.getItem('intercom_token');

function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('intercom_token', t);
  else localStorage.removeItem('intercom_token');
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...(opts.headers as Record<string, string> | undefined) } });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

export const api = {
  async login(email: string, password: string) {
    const out = await req<{ token: string; user: SessionUser }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    setToken(out.token);
    return out.user;
  },
  async me() {
    return req<{ user: SessionUser }>('/auth/me').then(r => r.user);
  },
  logout() {
    setToken(null);
    return req('/auth/logout', { method: 'POST' }).catch(() => {});
  },
  isLoggedIn() { return !!token; },

  listEndpoints() { return req<Endpoint[]>('/endpoints'); },
  createEndpoint(body: Partial<Endpoint>) {
    return req<Endpoint>('/endpoints', { method: 'POST', body: JSON.stringify(body) });
  },
  pollHealth() { return req('/endpoints/poll', { method: 'POST' }); },
  endpointHealthLog(id: string) {
    return req<{ status: string; latency_ms: number | null; error_message: string | null; checked_at: string }[]>(
      `/endpoints/${id}/health`);
  },

  endSession(id: string, reason?: string) {
    return req(`/intercom/sessions/${id}/end`, { method: 'POST', body: JSON.stringify({ reason }) });
  },
  setPtt(sessionId: string, endpointId: string, muted: boolean) {
    return req(`/intercom/sessions/${sessionId}/ptt`, {
      method: 'POST', body: JSON.stringify({ endpointId, muted }),
    });
  },
  listSessions() { return req<IntercomSession[]>('/intercom/sessions'); },
  getLiveStatus() { return req<{ registrations: LiveRegistration[]; calls: LiveCall[] }>('/live'); },
  listSessionParticipants(id: string) {
    return req<SessionParticipant[]>(`/intercom/sessions/${id}/participants`);
  },

  listGroups() { return req<Group[]>('/groups'); },
  createGroup(body: { name: string; description?: string; mode?: 'talkback' | 'announce'; ptt_default?: boolean; dial_code?: string }) {
    return req<Group>('/groups', { method: 'POST', body: JSON.stringify(body) });
  },
  updateGroup(id: string, body: Partial<{ name: string; description: string; mode: 'talkback' | 'announce'; ptt_default: boolean; dial_code: string }>) {
    return req<Group>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  deleteGroup(id: string) {
    return req(`/groups/${id}`, { method: 'DELETE' });
  },
  listGroupMembers(groupId: string) { return req<GroupMember[]>(`/groups/${groupId}/members`); },
  addGroupMember(groupId: string, endpointId: string, role: 'member' | 'announcer' = 'member', canTalk = true) {
    return req<GroupMember>(`/groups/${groupId}/members`, {
      method: 'POST', body: JSON.stringify({ endpointId, role, canTalk }),
    });
  },
  removeGroupMember(groupId: string, endpointId: string) {
    return req(`/groups/${groupId}/members/${endpointId}`, { method: 'DELETE' });
  },
  startGroup(groupId: string) {
    return req<{ sessionId: string }>(`/intercom/groups/${groupId}/start`, { method: 'POST' });
  },

  listDirectoryUsers() { return req<DirectoryUser[]>('/directory-users'); },
  createDirectoryUser(body: { name: string; extension: string; password: string }) {
    return req<DirectoryUser>('/directory-users', { method: 'POST', body: JSON.stringify(body) });
  },
  updateDirectoryUser(id: string, body: Partial<{ name: string; extension: string; enabled: boolean }>) {
    return req<DirectoryUser>(`/directory-users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  deleteDirectoryUser(id: string) {
    return req(`/directory-users/${id}`, { method: 'DELETE' });
  },
  resetDirectoryUserPassword(id: string, password: string) {
    return req(`/directory-users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
  },
  listDirectoryUserButtons(id: string) { return req<DirectoryUserButton[]>(`/directory-users/${id}/buttons`); },
  addDirectoryUserButton(id: string, body: {
    button_type: 'direct' | 'group'; target_extension?: string; target_group_id?: string; label?: string;
  }) {
    return req<DirectoryUserButton>(`/directory-users/${id}/buttons`, { method: 'POST', body: JSON.stringify(body) });
  },
  removeDirectoryUserButton(id: string, buttonId: string) {
    return req(`/directory-users/${id}/buttons/${buttonId}`, { method: 'DELETE' });
  },

  getSystemHealth() { return req<SystemHealth>('/system/health'); },
  getAuditLog(params: { entity_type?: string; actor?: string; limit?: number; offset?: number } = {}) {
    const p = new URLSearchParams();
    if (params.entity_type) p.set('entity_type', params.entity_type);
    if (params.actor) p.set('actor', params.actor);
    if (params.limit != null) p.set('limit', String(params.limit));
    if (params.offset != null) p.set('offset', String(params.offset));
    return req<{ rows: AuditLogEntry[]; total: number; limit: number; offset: number }>(`/system/audit?${p}`);
  },
  getContainerLogs(service: string, lines = 100) {
    return req<ContainerLogs>(`/system/logs/${service}?lines=${lines}`);
  },

  async downloadBackup() {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(`${BASE}/admin/backup`, { method: 'POST', headers });
    if (!resp.ok) throw new Error(`Backup failed: HTTP ${resp.status}`);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `intercom-backup-${new Date().toISOString().slice(0, 10)}.sql`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  async restoreBackup(sqlText: string) {
    return req<{ ok: boolean; message: string }>('/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: sqlText,
    });
  },
  getBackupInfo() { return req<BackupInfo>('/admin/backup/info'); },
  getDbStats() { return req<DbStats>('/admin/db/stats'); },
  runVacuum() { return req<{ ok: boolean; message: string }>('/admin/db/vacuum', { method: 'POST' }); },
  purgeTable(table: 'audit_log' | 'intercom_sessions', days: number) {
    return req<{ ok: boolean; deleted: number; message: string }>('/admin/db/purge', {
      method: 'POST', body: JSON.stringify({ table, days }),
    });
  },
  archiveTables(days: number, transfer?: { type: 'scp' | 'sftp' | 'ftp' | 'local'; host?: string; port?: number; user?: string; path: string; key_path?: string }) {
    return req<{ ok: boolean; archive_name: string; size_bytes: number; transfer: string }>('/admin/db/archive', {
      method: 'POST', body: JSON.stringify({ days, transfer }),
    });
  },
};
