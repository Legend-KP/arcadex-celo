import { NextResponse } from "next/server";

export function getAdminPassword(): string {
  return (
    process.env.ADMIN_PASSWORD ??
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ??
    "arcadex2024"
  );
}

export function verifyAdminRequest(request: Request): boolean {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7) === getAdminPassword();
  }

  return request.headers.get("X-Admin-Password") === getAdminPassword();
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function apiErrorResponse(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
