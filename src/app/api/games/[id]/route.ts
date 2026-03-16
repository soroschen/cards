import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

function getUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  return verifyToken(auth.replace("Bearer ", ""));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      players: { include: { user: { select: { id: true, username: true, avatar: true } } } },
      rounds: {
        include: { teamStates: true },
        orderBy: { roundNumber: "asc" },
      },
    },
  });

  if (!game) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  return NextResponse.json(game);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const { status } = await req.json();

  const game = await prisma.game.update({
    where: { id },
    data: { status, finishedAt: status === "finished" ? new Date() : null },
  });
  return NextResponse.json(game);
}
