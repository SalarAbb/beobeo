import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect on missing session cookie; real auth checks happen
// server-side in layouts and tRPC procedures.
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/transactions/:path*", "/tax-center/:path*", "/compare/:path*", "/chat/:path*", "/positions/:path*", "/accounts/:path*", "/account", "/account/:path*", "/welcome"],
};
