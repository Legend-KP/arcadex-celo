import { NextResponse } from "next/server";

const ALLOWED_METHODS = "GET, POST, PUT, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";

function getShellOrigin(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
}

function getAllowedCorsOrigins(): Set<string> {
  const origins = new Set<string>();

  for (const entry of process.env.ALLOWED_CORS_ORIGINS?.split(",") ?? []) {
    const trimmed = entry.trim();
    if (trimmed) origins.add(trimmed);
  }

  const shellOrigin = getShellOrigin();
  if (shellOrigin) origins.add(shellOrigin);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  const allowlist = getAllowedCorsOrigins();
  if (allowlist.has(origin)) return true;

  // Optional suffix match for game CDNs, e.g. ".pages.dev"
  const suffix = process.env.ALLOWED_CORS_ORIGIN_SUFFIX?.trim();
  if (suffix && origin.endsWith(suffix)) return true;

  return false;
}

/** CORS headers so Unity WebGL (game CDN origin) can call shell APIs directly. */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  };

  if (origin && isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
}

export function handleCorsPreflightRequest(request: Request): NextResponse {
  const origin = request.headers.get("Origin");
  if (origin && !isOriginAllowed(origin)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function corsJsonResponse(
  request: Request,
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const origin = request.headers.get("Origin");
  if (origin && !isOriginAllowed(origin)) {
    return NextResponse.json(
      { error: "Origin not allowed." },
      { status: 403 }
    );
  }

  const headers = new Headers(init?.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  return NextResponse.json(data, {
    ...init,
    headers,
  });
}
