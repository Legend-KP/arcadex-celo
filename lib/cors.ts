import { NextResponse } from "next/server";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type";

/** CORS headers so Unity WebGL (game CDN origin) can call shell APIs directly. */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

export function handleCorsPreflightRequest(request: Request): NextResponse {
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
