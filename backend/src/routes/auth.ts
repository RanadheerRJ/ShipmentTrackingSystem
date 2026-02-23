import { Router } from 'express';
import db from '../db';
import { verifyPassword } from '../utils/hash';
import { signToken, verifyToken } from '../utils/jwt';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken({ id: user.id });
  const publicUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone_number: user.phone_number ?? null,
    address: user.address ?? null,
    profile_photo_data_url: user.profile_photo_data_url ?? null,
    organization_id: user.organization_id,
    is_active: !!user.is_active,
  };
  res.json({ token, user: publicUser });
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(200).json({ user: null });
  const payload = verifyToken(token);
  if (!payload?.id) return res.status(200).json({ user: null });
  const user = db.prepare(`
    SELECT id, email, name, role, phone_number, address, profile_photo_data_url, organization_id, is_active
    FROM users
    WHERE id = ?
  `).get(payload.id) as any;
  if (!user || !user.is_active) return res.status(200).json({ user: null });
  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone_number: user.phone_number ?? null,
      address: user.address ?? null,
      profile_photo_data_url: user.profile_photo_data_url ?? null,
      organization_id: user.organization_id,
      is_active: !!user.is_active,
    },
  });
});

export default router;
