import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

function getUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  return verifyToken(auth.replace("Bearer ", ""));
}

// GET /api/games - list all games
export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const games = await prisma.game.findMany({
    include: {
      players: { include: { user: { select: { id: true, username: true, avatar: true } } } },
      rounds: { orderBy: { roundNumber: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(games);
}

// POST /api/games - create a new game
export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { name, baseScore, teamA, teamB } = await req.json();

  // Allow 1+ players - AI will fill remaining spots in the room
  if (!teamA || teamA.length < 1) {
    return NextResponse.json({ error: "至少需要1名玩家" }, { status: 400 });
  }

  const game = await prisma.game.create({
    data: {
      name: name || `${new Date().toLocaleDateString("zh-CN")} 场次`,
      baseScore: baseScore || 10,
      createdBy: user.userId,
      players: {
        create: [
          ...teamA.map((userId: string, i: number) => ({ userId, team: "A", seatOrder: i })),
          ...teamB.map((userId: string, i: number) => ({ userId, team: "B", seatOrder: i })),
        ],
      },
    },
    include: {
      players: { include: { user: { select: { id: true, username: true, avatar: true } } } },
    },
  });

  // Initialize team states: both teams start at level "2", team A attacks first
  const firstRound = await prisma.round.create({
    data: {
      gameId: game.id,
      roundNumber: 0,
      attackerTeam: "A",
      winnerTeam: "A",
      levelChange: 0,
      recordedBy: user.userId,
      teamStates: {
        create: [
          { gameId: game.id, team: "A", currentLevel: "2", isAttacker: true },
          { gameId: game.id, team: "B", currentLevel: "2", isAttacker: false },
        ],
      },
    },
    include: { teamStates: true },
  });

  return NextResponse.json({ ...game, initRound: firstRound });
}
