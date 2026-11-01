import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_HOST = (process.env.NEXT_PUBLIC_ADMIN_HOST ?? "").toLowerCase();

function hostFromRequest(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

function isAdminHost(host: string): boolean {
  return Boolean(ADMIN_HOST) && host === ADMIN_HOST;
}

/**
 * Existing files under these prefixes are served by Workers static assets
 * and never reach this function. A request that does arrive is a missing
 * file. Returning here avoids rendering the Next.js 404 page, which was
 * costing 50–120 ms of CPU per broken image.
 */
function missingStaticAsset(pathname: string): boolean {
  return (
    pathname === "/favicon.ico" ||
    pathname.startsWith("/games/") ||
    pathname.startsWith("/thumbnails/") ||
    pathname.startsWith("/tutorials/")
  );
}

export function middleware(request: NextRequest) {
  const host = hostFromRequest(request);
  const { pathname } = request.nextUrl;

  if (missingStaticAsset(pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "cache-control": "public, max-age=3600",
        "cdn-cache-control": "public, max-age=3600",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const onAdminHost = isAdminHost(host);

  if (onAdminHost) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    if (pathname === "/" || pathname.startsWith("/game")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    if (!pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (ADMIN_HOST && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/game/:path*",
    "/games/:path*",
    "/thumbnails/:path*",
    "/tutorials/:path*",
    "/favicon.ico",
  ],
};
