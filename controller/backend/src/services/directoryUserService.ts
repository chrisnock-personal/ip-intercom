// src/services/directoryUserService.ts
// Directory users are turret-login people — distinct from `users` (console
// operator login, userService.ts). See migrations/008_directory_users.sql.
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db/pool';
import { createError } from '../middleware/errorHandler';

export interface DirectoryUser {
  id: string;
  name: string;
  extension: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DirectoryUserButton {
  id: string;
  directory_user_id: string;
  button_type: 'direct' | 'group';
  target_extension: string | null;
  target_group_id: string | null;
  target_group_name: string | null;
  target_group_dial_code: string | null; // group buttons dial GROUP_PREFIX + this, e.g. "*8" + "floor-a"
  target_group_ptt_default: boolean | null; // group's PTT default — turret starts muted (PTT) or talking (open mic) accordingly
  label: string | null;
  sort_order: number;
}

const PUBLIC_COLUMNS = 'id, name, extension, enabled, created_at, updated_at';

/** pbx-core's registrar is one flat in-memory AOR namespace shared by
 * intercom_endpoints.aor and directory-user extensions — reject a collision
 * here since Postgres can't enforce it as a cross-table constraint cheaply. */
async function assertExtensionAvailable(extension: string, excludeId?: string): Promise<void> {
  const endpointClash = await queryOne(
    `SELECT id FROM intercom_endpoints WHERE LOWER(aor) LIKE LOWER($1)`,
    [`sip:${extension}@%`]);
  if (endpointClash) throw createError(`Extension ${extension} is already used by a station`, 409);

  // Cast the fallback literal to uuid explicitly — otherwise Postgres infers
  // COALESCE($2, '...')'s result as text (since a bare string literal
  // defaults to unknown/text), and `id != <text>` has no operator overload
  // against a uuid column ("operator does not exist: uuid <> text").
  const userClash = await queryOne(
    `SELECT id FROM intercom_directory_users WHERE LOWER(extension) = LOWER($1) AND id != COALESCE($2, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [extension, excludeId ?? null]);
  if (userClash) throw createError(`Extension ${extension} is already assigned to another directory user`, 409);
}

export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
  const { rows } = await query<DirectoryUser>(
    `SELECT ${PUBLIC_COLUMNS} FROM intercom_directory_users ORDER BY name`);
  return rows;
}

export async function getDirectoryUser(id: string): Promise<DirectoryUser> {
  const u = await queryOne<DirectoryUser>(
    `SELECT ${PUBLIC_COLUMNS} FROM intercom_directory_users WHERE id = $1`, [id]);
  if (!u) throw createError('Directory user not found', 404);
  return u;
}

export async function createDirectoryUser(
  actor: string, fields: { name: string; extension: string; password: string }
): Promise<DirectoryUser> {
  const { name, extension, password } = fields;
  if (!name || !extension || !password) throw createError('name, extension, and password are required', 400);
  await assertExtensionAvailable(extension);

  const hash = await bcrypt.hash(password, 12);
  const u = await queryOne<DirectoryUser>(
    `INSERT INTO intercom_directory_users (name, extension, password_hash, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name, extension, hash, actor]);
  if (!u) throw createError('Failed to create directory user', 500);
  return u;
}

export async function updateDirectoryUser(
  actor: string, id: string, fields: { name?: string; extension?: string; enabled?: boolean }
): Promise<DirectoryUser> {
  const current = await getDirectoryUser(id);
  const name = fields.name ?? current.name;
  const extension = fields.extension ?? current.extension;
  const enabled = fields.enabled ?? current.enabled;
  if (fields.extension && fields.extension !== current.extension) {
    await assertExtensionAvailable(fields.extension, id);
  }

  const u = await queryOne<DirectoryUser>(
    `UPDATE intercom_directory_users SET name = $1, extension = $2, enabled = $3, updated_by = $4
     WHERE id = $5 RETURNING ${PUBLIC_COLUMNS}`,
    [name, extension, enabled, actor, id]);
  if (!u) throw createError('Directory user not found', 404);
  return u;
}

export async function deleteDirectoryUser(id: string): Promise<void> {
  const result = await query(`DELETE FROM intercom_directory_users WHERE id = $1`, [id]);
  if (result.rowCount === 0) throw createError('Directory user not found', 404);
}

export async function resetPassword(id: string, password: string): Promise<void> {
  if (!password || password.length < 4) throw createError('password must be at least 4 characters', 400);
  const hash = await bcrypt.hash(password, 12);
  const result = await query(
    `UPDATE intercom_directory_users SET password_hash = $1 WHERE id = $2`, [hash, id]);
  if (result.rowCount === 0) throw createError('Directory user not found', 404);
}

/** Used by the turret login endpoint. Extension is the login identifier. */
export async function authenticateDirectoryUser(extension: string, password: string): Promise<DirectoryUser> {
  const user = await queryOne<DirectoryUser & { password_hash: string }>(
    `SELECT * FROM intercom_directory_users WHERE LOWER(extension) = LOWER($1) AND enabled = TRUE`,
    [extension]);
  if (!user) throw createError('Invalid credentials', 401);
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw createError('Invalid credentials', 401);
  return user;
}

export async function listButtons(directoryUserId: string): Promise<DirectoryUserButton[]> {
  const { rows } = await query<DirectoryUserButton>(
    `SELECT b.id, b.directory_user_id, b.button_type, b.target_extension, b.target_group_id,
            g.name AS target_group_name, g.dial_code AS target_group_dial_code,
            g.ptt_default AS target_group_ptt_default,
            b.label, b.sort_order
     FROM intercom_directory_user_buttons b
     LEFT JOIN intercom_groups g ON g.id = b.target_group_id
     WHERE b.directory_user_id = $1
     ORDER BY b.sort_order, b.created_at`,
    [directoryUserId]);
  return rows;
}

export async function addButton(
  directoryUserId: string,
  fields: {
    button_type: 'direct' | 'group';
    target_extension?: string;
    target_group_id?: string;
    label?: string;
    sort_order?: number;
  }
): Promise<DirectoryUserButton> {
  const { button_type, target_extension, target_group_id, label, sort_order } = fields;
  if (!['direct', 'group'].includes(button_type)) throw createError('button_type must be direct or group', 400);
  if (button_type === 'direct' && !target_extension) throw createError('target_extension is required for a direct button', 400);
  if (button_type === 'group' && !target_group_id) throw createError('target_group_id is required for a group button', 400);

  const b = await queryOne<{ id: string }>(
    `INSERT INTO intercom_directory_user_buttons
       (directory_user_id, button_type, target_extension, target_group_id, label, sort_order)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0))
     RETURNING id`,
    [directoryUserId, button_type,
      button_type === 'direct' ? target_extension : null,
      button_type === 'group' ? target_group_id : null,
      label ?? null, sort_order ?? null]);
  if (!b) throw createError('Failed to create button', 500);
  const all = await listButtons(directoryUserId);
  return all.find((x) => x.id === b.id)!;
}

export async function removeButton(directoryUserId: string, buttonId: string): Promise<void> {
  const result = await query(
    `DELETE FROM intercom_directory_user_buttons WHERE id = $1 AND directory_user_id = $2`,
    [buttonId, directoryUserId]);
  if (result.rowCount === 0) throw createError('Button not found', 404);
}
