import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIX = "/profile";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccess = Boolean(request.cookies.get("access_token")?.value);

  if (pathname.startsWith(PROTECTED_PREFIX) || pathname.startsWith("/favorites") || pathname.startsWith("/recently-viewed")) {
    if (!hasAccess) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*", "/favorites/:path*", "/recently-viewed/:path*"]
};

