import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password, avatar } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }
  if (username.length < 2 || username.length > 12) {
    return NextResponse.json({ error: "用户名需2-12字符" }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json({ error: "密码至少4位" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "用户名已存在" }, { status: 409 });
  }

  const hashed = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username, password: hashed, avatar: avatar || "🃏" },
  });

  const token = signToken({ userId: user.id, username: user.username });
  return NextResponse.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
}
