import { randomBytes, timingSafeEqual } from "node:crypto";
import { serialize, parse } from "cookie";
import type { Response } from "express";
import { env } from "../env.js";

/**
 * Anonymous session design (see docs/DECISIONS.md ADR "anonymous session design"):
 * an opaque, high-entropy, server-generated bearer token stored in an httpOnly
 * cookie. No signup, no JWT — the token is unguessable by construction (256
 * bits) and every use is checked against the DB row it was issued for via a
 * constant-time comparison, so there is nothing decodable client-side and
 * nothing to forge. This is the same trust model as a standard server-side
 * session ID cookie.
 */

const COOKIE_MAX_AGE_SECONDS = env.SESSION_TTL_DAYS * 24 * 60 * 60;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionCookieValue {
  playerId: string;
  token: string;
}

export function serializeSessionCookie(value: SessionCookieValue): string {
  return serialize(env.SESSION_COOKIE_NAME, `${value.playerId}.${value.token}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function setSessionCookie(res: Response, value: SessionCookieValue): void {
  res.setHeader("Set-Cookie", serializeSessionCookie(value));
}

export function parseSessionCookie(cookieHeader: string | undefined): SessionCookieValue | null {
  if (!cookieHeader) return null;
  const parsed = parse(cookieHeader);
  const raw = parsed[env.SESSION_COOKIE_NAME];
  if (!raw) return null;
  const dotIndex = raw.indexOf(".");
  if (dotIndex <= 0) return null;
  const playerId = raw.slice(0, dotIndex);
  const token = raw.slice(dotIndex + 1);
  if (!playerId || !token) return null;
  return { playerId, token };
}

/** Constant-time comparison to avoid leaking session-token equality via timing. */
export function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
