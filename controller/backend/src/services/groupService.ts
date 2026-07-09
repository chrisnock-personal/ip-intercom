// src/services/groupService.ts
import { query, queryOne } from '../db/pool';
import { createError } from '../middleware/errorHandler';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  mode: 'talkback' | 'announce';
  ptt_default: boolean;
  dial_code: string;
  created_at: string;
  updated_at: string;
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
}

export async function listGroups(): Promise<Group[]> {
  const { rows } = await query<Group>(`SELECT * FROM intercom_groups ORDER BY name`);
  return rows;
}

export async function getGroup(id: string): Promise<Group> {
  const g = await queryOne<Group>(`SELECT * FROM intercom_groups WHERE id = $1`, [id]);
  if (!g) throw createError('Group not found', 404);
  return g;
}

export async function getGroupByDialCode(dialCode: string): Promise<Group | null> {
  return queryOne<Group>(`SELECT * FROM intercom_groups WHERE dial_code = $1`, [dialCode]);
}

export async function createGroup(
  actor: string,
  fields: { name: string; description?: string; mode?: 'talkback' | 'announce'; ptt_default?: boolean; dial_code?: string }
): Promise<Group> {
  const dialCode = fields.dial_code?.trim() || slugify(fields.name);
  if (!dialCode) throw createError('Could not derive a dial code from the group name', 400);
  const g = await queryOne<Group>(
    `INSERT INTO intercom_groups (name, description, mode, ptt_default, dial_code, created_by, updated_by)
     VALUES ($1,$2,COALESCE($3,'talkback'),COALESCE($4,FALSE),$5,$6,$6)
     RETURNING *`,
    [fields.name, fields.description ?? null, fields.mode ?? null, fields.ptt_default ?? null, dialCode, actor]
  );
  if (!g) throw createError('Failed to create group', 500);
  return g;
}

export async function updateGroup(
  actor: string,
  id: string,
  fields: { name?: string; description?: string; mode?: 'talkback' | 'announce'; ptt_default?: boolean; dial_code?: string }
): Promise<Group> {
  const current = await getGroup(id);
  const name = fields.name ?? current.name;
  const description = fields.description ?? current.description;
  const mode = fields.mode ?? current.mode;
  const pttDefault = fields.ptt_default ?? current.ptt_default;
  const dialCode = fields.dial_code?.trim() || current.dial_code;

  const g = await queryOne<Group>(
    `UPDATE intercom_groups SET name = $1, description = $2, mode = $3, ptt_default = $4, dial_code = $5, updated_by = $6
     WHERE id = $7 RETURNING *`,
    [name, description, mode, pttDefault, dialCode, actor, id]
  );
  if (!g) throw createError('Group not found', 404);
  return g;
}

/** Cascades: intercom_directory_user_buttons.target_group_id and
 * intercom_group_members.group_id both ON DELETE CASCADE — any button
 * pointing at this group is removed too, along with its membership rows. */
export async function deleteGroup(id: string): Promise<void> {
  const result = await query(`DELETE FROM intercom_groups WHERE id = $1`, [id]);
  if (result.rowCount === 0) throw createError('Group not found', 404);
}

export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const { rows } = await query<GroupMember>(
    `SELECT m.id, m.group_id, m.endpoint_id, e.name AS endpoint_name, e.rest_url, m.role, m.can_talk
     FROM intercom_group_members m
     JOIN intercom_endpoints e ON e.id = m.endpoint_id
     WHERE m.group_id = $1
     ORDER BY e.name`, [groupId]
  );
  return rows;
}

export async function addMember(
  groupId: string, endpointId: string, role: 'member' | 'announcer' = 'member', canTalk = true
): Promise<GroupMember> {
  const m = await queryOne<{ id: string }>(
    `INSERT INTO intercom_group_members (group_id, endpoint_id, role, can_talk)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (group_id, endpoint_id) DO UPDATE SET role = $3, can_talk = $4
     RETURNING id`,
    [groupId, endpointId, role, canTalk]
  );
  const all = await listMembers(groupId);
  return all.find(x => x.id === m!.id) ?? all[0];
}

export async function removeMember(groupId: string, endpointId: string): Promise<void> {
  await query(`DELETE FROM intercom_group_members WHERE group_id = $1 AND endpoint_id = $2`, [groupId, endpointId]);
}
