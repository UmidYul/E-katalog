import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIX = "/profile";
const DASHBOARD_PREFIX = "/dashboard";
const DASHBOARD_ADMIN_PREFIX = "/dashboard/admin";
const DASHBOARD_SELLER_PREFIX = "/dashboard/seller";
const B2B_PREFIX = "/b2b";
const SELLER_PREFIX = "/seller";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccess = Boolean(request.cookies.get("access_token")?.value);
  const role = String(request.cookies.get("user_role")?.value ?? "").trim().toLowerCase();

  if (pathname === SELLER_PREFIX || pathname.startsWith(`${SELLER_PREFIX}/`)) {
    const suffix = pathname.slice(SELLER_PREFIX.length);
    const target = `${DASHBOARD_SELLER_PREFIX}${suffix}`;
    const redirectUrl = new URL(target || DASHBOARD_SELLER_PREFIX, request.url);
    if (request.nextUrl.search) {
      redirectUrl.search = request.nextUrl.search;
    }
    return NextResponse.redirect(redirectUrl);
  }

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
  }

  if ((pathname.startsWith(B2B_PREFIX) || pathname.startsWith(SELLER_PREFIX)) && !hasAccess) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith(DASHBOARD_ADMIN_PREFIX) && role && role !== "admin") {
    return NextResponse.redirect(new URL("/403", request.url));
  }

  if (pathname.startsWith(DASHBOARD_SELLER_PREFIX) && role && role !== "seller") {
    return NextResponse.redirect(new URL("/403", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*", "/favorites/:path*", "/recently-viewed/:path*", "/dashboard/:path*", "/b2b/:path*", "/seller/:path*"]
};

