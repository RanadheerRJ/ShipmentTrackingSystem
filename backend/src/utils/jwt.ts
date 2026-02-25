import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';

const SECRET: string =
  process.env.JWT_SECRET ?? 'replace_this_with_env_secret';

export interface TokenPayload extends JwtPayload {
  id: string;
}

export function signToken(
  payload: object,
  expiresIn: NonNullable<SignOptions['expiresIn']> = '8h'
): string {
  const options: SignOptions = { expiresIn };

  return jwt.sign(payload, SECRET, options);
}

function isTokenPayload(payload: string | JwtPayload): payload is TokenPayload {
  return typeof payload !== 'string' && typeof payload.id === 'string' && payload.id.length > 0;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, SECRET);
    return isTokenPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}
