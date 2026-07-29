import { NextResponse, type NextRequest } from "next/server";
import { resolveBrandFromHost, resolveBrandFromPath } from "@/lib/brands";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  const hostBrand = resolveBrandFromHost(host);
  const brand = resolveBrandFromPath(req.nextUrl.pathname, hostBrand);

  // populartickets.pl → checkout hub for trials & events
  if (hostBrand.id === "tickets" && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/pay";
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-brand-id", brand.id);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  res.cookies.set("studio_brand_id", brand.id, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
