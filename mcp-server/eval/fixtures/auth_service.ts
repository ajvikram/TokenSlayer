import { createHash, randomBytes } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  roles: string[];
  createdAt: Date;
}

export interface AuthToken {
  token: string;
  userId: string;
  expiresAt: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  saveToken(token: AuthToken): Promise<void>;
  findToken(token: string): Promise<AuthToken | null>;
  revokeToken(token: string): Promise<void>;
}

export class AuthService {
  private readonly TOKEN_TTL_MS = 60 * 60 * 1000;

  constructor(private readonly repo: AuthRepository) {}

  async login(email: string, password: string): Promise<AuthToken | null> {
    const user = await this.repo.findUserByEmail(email);
    if (!user) return null;
    if (!this.verifyPassword(password, user.passwordHash)) return null;
    const token: AuthToken = {
      token: randomBytes(32).toString('hex'),
      userId: user.id,
      expiresAt: new Date(Date.now() + this.TOKEN_TTL_MS),
    };
    await this.repo.saveToken(token);
    return token;
  }

  async logout(token: string): Promise<void> {
    await this.repo.revokeToken(token);
  }

  async verify(token: string): Promise<UserRecord | null> {
    const found = await this.repo.findToken(token);
    if (!found || found.expiresAt < new Date()) return null;
    // In real code this would re-fetch the user record. For the demo we trust the token.
    return null;
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const header = req.header('authorization');
      if (!header) {
        res.status(401).json({ error: 'missing token' });
        return;
      }
      const token = header.replace(/^Bearer\s+/, '');
      const user = await this.verify(token);
      if (!user) {
        res.status(401).json({ error: 'invalid token' });
        return;
      }
      (req as any).user = user;
      next();
    };
  }

  private verifyPassword(password: string, hash: string): boolean {
    const computed = createHash('sha256').update(password).digest('hex');
    return computed === hash;
  }
}
