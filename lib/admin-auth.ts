import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieHeader,
  verifyAdminSessionToken,
} from "@/lib/admin-session";

export function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_PASSWORD is required in production.");
    }
    return "dev-admin-password-change-me";
  }
  return password;
}

export async function verifyAdminRequest(request: Request): Promise<boolean> {
  const cookieToken = parseCookieHeader(
    request.headers.get("Cookie"),
    ADMIN_SESSION_COOKIE
  );
  if (cookieToken && (await verifyAdminSessionToken(cookieToken))) {
    return true;
  }

  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && (await verifyAdminSessionToken(token))) {
      return true;
    }
  }

  return false;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function apiErrorResponse(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
