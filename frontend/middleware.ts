import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIX = "/profile";
const DASHBOARD_PREFIX = "/dashboard";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccess = Boolean(request.cookies.get("access_token")?.value);
  const role = request.cookies.get("user_role")?.value;

  if (pathname.startsWith(PROTECTED_PREFIX) || pathname.startsWith("/favorites") || pathname.startsWith("/recently-viewed")) {
    if (!hasAccess) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (pathname.startsWith(DASHBOARD_PREFIX)) {
    if (!hasAccess) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (role && role !== "admin" && role !== "moderator") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*", "/favorites/:path*", "/recently-viewed/:path*", "/dashboard/:path*"]
};

