export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
  create(user: NewUser): Promise<User>;
}

export interface Session {
  id: string; // hash of the session token, see src/auth/session.ts
  userId: string;
  expiresAt: Date;
}

export interface NewSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface SessionRepository {
  create(session: NewSession): Promise<Session>;
  findById(id: string): Promise<Session | undefined>;
  deleteById(id: string): Promise<void>;
}
