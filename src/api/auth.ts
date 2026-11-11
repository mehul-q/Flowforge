import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';
if (JWT_SECRET.length < 32 && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export interface TokenPayload {
  sub: string;
  role: 'admin' | 'viewer';
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
}

export function requireAuth(
  req: any,
  res: any,
  next: any,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing token' });
    return;
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export function requireAdmin(req: any, res: any, next: any): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'admin required' });
    return;
  }
  next();
}