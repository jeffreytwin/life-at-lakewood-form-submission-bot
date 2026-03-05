import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  const validUser = process.env.LOGIN_USERNAME ?? "jeff@lifeatlakewood.com";
  const validPass = process.env.LOGIN_PASSWORD ?? "Starwars1234!";

  if (username === validUser && password === validPass) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("session", "authenticated", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  }

  return NextResponse.json(
    { error: "Invalid username or password" },
    { status: 401 }
  );
}
