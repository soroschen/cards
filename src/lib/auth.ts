import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "shengji-secret-key-change-in-prod";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: { userId: string; username: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: string; username: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
  } catch {
    return null;
  }
}

export const LEVELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export function getNextLevel(current: string, steps: number): string {
  const idx = LEVELS.indexOf(current);
  const next = idx + steps;
  if (next >= LEVELS.length) return "A"; // 已到顶
  return LEVELS[next];
}

export function getPrevLevel(current: string, steps: number): string {
  const idx = LEVELS.indexOf(current);
  const prev = idx - steps;
  if (prev < 0) return "2";
  return LEVELS[prev];
}
