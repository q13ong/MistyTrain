/**
 * 账号与会话服务。
 *
 * 密码使用 Argon2id 哈希；客户端只持有随机 Session Token，
 * 数据库中保存 Token 的 SHA-256 摘要，避免数据库泄漏后直接冒用会话。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyReply } from "fastify";
import {
  createSession,
  createUser,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  findUserByNicknameKey,
  revokeSession,
} from "../db/repository";
import { isProduction } from "../config";

export const SESSION_COOKIE = "fog_train_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeNicknameKey(nickname: string): string {
  return nickname.trim().toLocaleLowerCase("zh-CN");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
    maxAge: SESSION_DURATION_MS / 1_000,
  };
}

export async function registerUser(input: {
  email: string;
  nickname: string;
  password: string;
}) {
  const email = normalizeEmail(input.email);
  const nickname = input.nickname.trim();
  const nicknameKey = normalizeNicknameKey(nickname);
  if (await findUserByEmail(email)) {
    throw new Error("EMAIL_EXISTS");
  }
  const existingByNickname = await findUserByNicknameKey(nicknameKey);
  if (existingByNickname) {
    throw new Error("NICKNAME_EXISTS");
  }

  const user = {
    id: randomUUID(),
    email,
    nickname,
    nicknameKey,
    passwordHash: await hash(input.password),
    createdAt: new Date(),
  };
  try {
    await createUser(user);
  } catch (error) {
    if (String(error).toLowerCase().includes("nickname")) throw new Error("NICKNAME_EXISTS");
    if (String(error).toLowerCase().includes("email")) throw new Error("EMAIL_EXISTS");
    throw error;
  }
  return user;
}

export async function loginUser(emailInput: string, password: string) {
  const user = await findUserByEmail(normalizeEmail(emailInput));
  if (!user || !(await verify(user.passwordHash, password))) {
    throw new Error("INVALID_CREDENTIALS");
  }
  return user;
}

export async function createUserSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await createSession({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    createdAt: new Date(),
  });
  return token;
}

export async function getUserBySessionToken(token: string | undefined) {
  if (!token) return null;
  const session = await findSessionByTokenHash(hashToken(token));
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user) return null;
  return { id: user.id, email: user.email, nickname: user.nickname };
}

export async function logoutSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await revokeSession(hashToken(token));
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
  });
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        return [[key, decodeURIComponent(value)]];
      } catch {
        return [[key, value]];
      }
    }),
  );
}
