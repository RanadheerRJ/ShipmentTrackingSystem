import jwt from 'jsonwebtoken';
import { promisify } from 'util';

const SECRET = process.env.JWT_SECRET || 'replace_this_with_env_secret';
const signAsync = promisify<string | Buffer | object, jwt.SignOptions, string>(jwt.sign as any);

export function signToken(payload: object, expiresIn = '8h') {
  return jwt.sign(payload, SECRET, { expiresIn });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, SECRET) as any;
  } catch {
    return null;
  }
}
