import { Router } from 'express';
import db from '../db';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/hash';
import { normalizeOptionalImageField } from '../utils/imageDataUrl';

const router = Router();
router.use(requireAuth);

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  phone_number: string | null;
  address: string | null;
  profile_photo_data_url: string | null;
  organization_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

router.get('/', (req, res) => {
  const q = req.query as any;
  if ((req as any).user.role === 'SuperAdmin') {
    const rows = db.prepare('SELECT id, email, name, role, phone_number, address, profile_photo_data_url, organization_id, is_active, created_at, updated_at FROM users').all();
    return res.json(rows);
  }
  // OrgAdmin or others: only users within their org
  const orgId = q.organizationId || (req as any).user.organization_id;
  const rows = db.prepare('SELECT id, email, name, role, phone_number, address, profile_photo_data_url, organization_id, is_active, created_at, updated_at FROM users WHERE organization_id = ?').all(orgId);
  res.json(rows);
});

router.get('/me', (req, res) => {
  const actor = (req as any).user;
  const currentUser = db.prepare(`
    SELECT id, email, name, role, phone_number, address, profile_photo_data_url, organization_id, is_active, created_at, updated_at
    FROM users
    WHERE id = ?
  `).get(actor.id) as any;
  if (!currentUser) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...currentUser,
    phone_number: currentUser.phone_number ?? null,
    address: currentUser.address ?? null,
    profile_photo_data_url: currentUser.profile_photo_data_url ?? null,
    is_active: !!currentUser.is_active,
  });
});

router.put('/me', (req, res) => {
  const actor = (req as any).user;
  const updates = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(actor.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date().toISOString();
  const profilePhotoField = normalizeOptionalImageField(updates.profile_photo_data_url, 'Profile photo');
  if (profilePhotoField.error) {
    return res.status(400).json({ error: profilePhotoField.error });
  }
  const nextPhoneNumber = updates.phone_number === undefined
    ? (user.phone_number ?? null)
    : (String(updates.phone_number || '').trim() || null);
  const nextAddress = updates.address === undefined
    ? (user.address ?? null)
    : (String(updates.address || '').trim() || null);
  const nextProfilePhoto = profilePhotoField.provided
    ? profilePhotoField.value
    : (user.profile_photo_data_url ?? null);

  if (nextPhoneNumber && !/^[0-9+().\-\s]+$/.test(nextPhoneNumber)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  db.prepare('UPDATE users SET phone_number = ?, address = ?, profile_photo_data_url = ?, updated_at = ? WHERE id = ?')
    .run(nextPhoneNumber, nextAddress, nextProfilePhoto, now, actor.id);

  const updated = db.prepare(`
    SELECT id, email, name, role, phone_number, address, profile_photo_data_url, organization_id, is_active, created_at, updated_at
    FROM users
    WHERE id = ?
  `).get(actor.id) as any;

  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      uuidv4(),
      'User',
      actor.id,
      'UPDATE',
      JSON.stringify({
        phone_number: user.phone_number ?? null,
        address: user.address ?? null,
        profile_photo_data_url: user.profile_photo_data_url ?? null,
      }),
      JSON.stringify({
        phone_number: updated.phone_number ?? null,
        address: updated.address ?? null,
        profile_photo_data_url: updated.profile_photo_data_url ?? null,
      }),
      actor.id,
      actor.name,
      actor.organization_id ?? null,
      now,
    );

  res.json({
    ...updated,
    phone_number: updated.phone_number ?? null,
    address: updated.address ?? null,
    profile_photo_data_url: updated.profile_photo_data_url ?? null,
    is_active: !!updated.is_active,
  });
});

router.put('/me/password', async (req, res) => {
  const actor = (req as any).user;
  const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
  const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }

  const user = db.prepare('SELECT id, password_hash, organization_id FROM users WHERE id = ?').get(actor.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const currentOk = await verifyPassword(currentPassword, user.password_hash);
  if (!currentOk) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, now, actor.id);

  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      uuidv4(),
      'User',
      actor.id,
      'UPDATE',
      JSON.stringify({ password_changed: false }),
      JSON.stringify({ password_changed: true }),
      actor.id,
      actor.name,
      actor.organization_id ?? user.organization_id ?? null,
      now,
    );

  res.json({ success: true });
});

router.post('/', async (req, res) => {
  const { email, name, password, role, organization_id } = req.body;
  const profilePhotoField = normalizeOptionalImageField(req.body?.profile_photo_data_url, 'Profile photo');
  if (profilePhotoField.error) {
    return res.status(400).json({ error: profilePhotoField.error });
  }
  const actor = (req as any).user;
  if (!(actor.role === 'SuperAdmin' || (actor.role === 'OrgAdmin' && actor.organization_id === organization_id))) {
    return res.status(403).json({ error: 'Insufficient role to create user' });
  }
  if (!email || !password || !name || !role) return res.status(400).json({ error: 'Missing fields' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(400).json({ error: 'Email already exists' });
  const id = uuidv4();
  const now = new Date().toISOString();
  const password_hash = await hashPassword(password);
  db.prepare('INSERT INTO users (id, email, name, password_hash, role, phone_number, address, profile_photo_data_url, organization_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?)')
    .run(id, email, name, password_hash, role, profilePhotoField.value, organization_id ?? null, now, now);
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'User', id, 'CREATE', null, JSON.stringify({ id, email, name, role, organization_id, profile_photo_data_url: profilePhotoField.value }), (req as any).user.id, (req as any).user.name, organization_id ?? null, now);
  res.status(201).json({ id, email, name, role, phone_number: null, address: null, profile_photo_data_url: profilePhotoField.value, organization_id });
});

router.put('/:id/role', (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const user = db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const actor = (req as any).user;
  const isSuperAdmin = actor.role === 'SuperAdmin';
  const isOrgAdminInSameOrg = actor.role === 'OrgAdmin' && actor.organization_id === user.organization_id;
  // SuperAdmin can change any role. OrgAdmin can only manage non-admin roles in their own org.
  if (!isSuperAdmin && !isOrgAdminInSameOrg) return res.status(403).json({ error: 'Insufficient role' });
  if (!isSuperAdmin && (user.role === 'SuperAdmin' || user.role === 'OrgAdmin' || role === 'SuperAdmin' || role === 'OrgAdmin')) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  const old = { role: user.role };
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, new Date().toISOString(), id);
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'User', id, 'ROLE_CHANGE', JSON.stringify(old), JSON.stringify({ role }), (req as any).user.id, (req as any).user.name, user.organization_id, new Date().toISOString());
  res.json({ id, role });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const user = db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const actor = (req as any).user;
  // Only SuperAdmin or OrgAdmin of same org may update
  if (actor.role !== 'SuperAdmin' && !(actor.role === 'OrgAdmin' && actor.organization_id === user.organization_id)) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET name = ?, is_active = ?, organization_id = ?, updated_at = ? WHERE id = ?')
    .run(updates.name ?? user.name, (updates.is_active === undefined ? user.is_active : (updates.is_active ? 1 : 0)), updates.organization_id ?? user.organization_id, now, id);
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'User', id, 'UPDATE', JSON.stringify(user), JSON.stringify({ ...user, ...updates }), (req as any).user.id, (req as any).user.name, user.organization_id, now);
  res.json({ id, ...updates });
});

export default router;
