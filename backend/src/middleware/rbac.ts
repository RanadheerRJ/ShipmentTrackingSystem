import { Response, NextFunction } from 'express';
import { AuthedRequest } from './auth';

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}
