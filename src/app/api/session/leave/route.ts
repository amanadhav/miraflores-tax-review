import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/context";

/** Forget this browser's session so the landing page can start or join another workspace. The workspace itself is kept. */
export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
