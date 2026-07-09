// src/services/userService.ts
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db/pool';
import { createError } from '../middleware/errorHandler';
import config from '../config';

export interface User {
  id: string; email: string; role: string;
  is_active: boolean; password_changed: boolean;
  created_at: string; last_login_at: string | null;
}

export async function seedDefaultAdmin(): Promise<void> {
  const hash = await bcrypt.hash(config.adminPass, 12);
  await query(`
    INSERT INTO users (email, password_hash, role, is_active, password_changed)
    VALUES ($1, $2, 'admin', TRUE, FALSE)
    ON CONFLICT (LOWER(email)) WHERE is_active = TRUE
    DO UPDATE SET password_hash = $2, password_changed = FALSE
  `, [config.adminEmail, hash]);
  console.log(`[users] Admin seeded: ${config.adminEmail}`);
}

export async function authenticate(email: string, password: string): Promise<User> {
  const user = await queryOne<User & { password_hash: string }>(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`, [email]);
  if (!user) throw createError('Invalid credentials', 401);
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw createError('Invalid credentials', 401);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return user;
}

export async function listUsers(): Promise<User[]> {
  const { rows } = await query<User>(
    `SELECT id, email, role, is_active, password_changed, created_at, last_login_at
     FROM users ORDER BY created_at`);
  return rows;
}

export async function createUser(email: string, password: string, role: string): Promise<User> {
  const hash = await bcrypt.hash(password, 12);
  const user = await queryOne<User>(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, email, role, is_active, password_changed, created_at, last_login_at`,
    [email, hash, role]);
  if (!user) throw createError('Failed to create user', 500);
  return user;
}

export async function changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await queryOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE', [id]);
  if (!user) throw createError('User not found', 404);
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw createError('Current password is incorrect', 401);
  const hash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE users SET password_hash = $1, password_changed = TRUE WHERE id = $2`, [hash, id]);
}
