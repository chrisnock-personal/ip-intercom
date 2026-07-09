// src/api.ts — thin fetch wrapper for the turret's own controller endpoints.
const BASE = '/api/v1/turret';

export interface Button {
  id: string;
  directory_user_id: string;
  button_type: 'direct' | 'group';
  target_extension: string | null;
  target_group_id: string | null;
  target_group_name: string | null;
  target_group_dial_code: string | null;
  target_group_ptt_default: boolean | null;
  channel: 'handset_a' | 'handset_b' | 'speaker';
  label: string | null;
  sort_order: number;
}

export interface TurretSession {
  name: string;
  extension: string;
  buttons: Button[];
  pbxWsHost: string;
  pbxWsPort: number;
}

// A shared desk kiosk, not a personal device — sessionStorage (not
// localStorage) so a reload after the tab closes never inherits the
// previous operator's session. Explicit Log out still needed for
// mid-shift handoffs without closing the tab.
let token: string | null = sessionStorage.getItem('turret_token');

function setToken(t: string | null) {
  token = t;
  if (t) sessionStorage.setItem('turret_token', t);
  else sessionStorage.removeItem('turret_token');
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...(opts.headers as Record<string, string> | undefined) } });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  async login(extension: string, password: string): Promise<TurretSession> {
    const out = await req<TurretSession & { token: string }>('/login', {
      method: 'POST', body: JSON.stringify({ extension, password }),
    });
    setToken(out.token);
    return out;
  },
  async me(): Promise<TurretSession> {
    return req<TurretSession>('/me');
  },
  logout() {
    setToken(null);
    return req('/logout', { method: 'POST' }).catch(() => {});
  },
  isLoggedIn() { return !!token; },

  reportCallEvent(evt: {
    type: 'start' | 'end'; clientCallId: string;
    kind?: 'direct' | 'group'; direction?: 'outgoing' | 'incoming';
    counterpartExtension?: string; reason?: string;
  }) {
    return req('/call-events', {
      method: 'POST',
      body: JSON.stringify({ event: evt.type, ...evt }),
    });
  },
};
