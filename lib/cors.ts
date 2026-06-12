import { NextResponse } from "next/server";

export const GAME_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsOptionsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: GAME_API_CORS_HEADERS,
  });
}

export function jsonWithCors(
  body: unknown,
  init?: ResponseInit
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...GAME_API_CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}
