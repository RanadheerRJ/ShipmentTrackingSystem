import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import db from '../db';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  phone_number: string | null;
  address: string | null;
  organization_id: string | null;
  is_active: number;
}

export interface AuthedRequest extends Request {
  user: AuthenticatedUser;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  const user = db.prepare<[string], AuthenticatedUser>('SELECT id, email, name, role, phone_number, address, organization_id, is_active FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!user.is_active) return res.status(403).json({ error: 'User inactive' });
  req.user = user;
  next();
}
