import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken, getNextLevel, getPrevLevel, LEVELS } from "@/lib/auth";

function getUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  return verifyToken(auth.replace("Bearer ", ""));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: gameId } = await params;
  const { attackerTeam, winnerTeam, levelChange, isDoubled, note } = await req.json();

  // Get last round to know current state
  const lastRound = await prisma.round.findFirst({
    where: { gameId },
    orderBy: { roundNumber: "desc" },
    include: { teamStates: true },
  });

  if (!lastRound) return NextResponse.json({ error: "游戏状态错误" }, { status: 400 });

  const prevStateA = lastRound.teamStates.find((s: { team: string }) => s.team === "A") as { team: string; currentLevel: string };
  const prevStateB = lastRound.teamStates.find((s: { team: string }) => s.team === "B") as { team: string; currentLevel: string };

  const defenderTeam = attackerTeam === "A" ? "B" : "A";
  const attackerWon = winnerTeam === attackerTeam;

  // Calculate new levels
  let newLevelA = prevStateA.currentLevel;
  let newLevelB = prevStateB.currentLevel;
  let nextAttacker = attackerTeam; // attacker stays if they win

  if (attackerWon) {
    // Attacker team upgrades
    if (attackerTeam === "A") {
      newLevelA = getNextLevel(prevStateA.currentLevel, levelChange);
    } else {
      newLevelB = getNextLevel(prevStateB.currentLevel, levelChange);
    }
    // Attacker stays as attacker next round
    nextAttacker = attackerTeam;
  } else {
    // Defender wins: defender upgrades, defender becomes attacker
    if (defenderTeam === "A") {
      newLevelA = getNextLevel(prevStateA.currentLevel, levelChange);
    } else {
      newLevelB = getNextLevel(prevStateB.currentLevel, levelChange);
    }
    nextAttacker = defenderTeam;
  }

  const roundNumber = lastRound.roundNumber + 1;

  const round = await prisma.round.create({
    data: {
      gameId,
      roundNumber,
      attackerTeam,
      winnerTeam,
      levelChange,
      isDoubled: isDoubled || false,
      note,
      recordedBy: user.userId,
      teamStates: {
        create: [
          { gameId, team: "A", currentLevel: newLevelA, isAttacker: nextAttacker === "A" },
          { gameId, team: "B", currentLevel: newLevelB, isAttacker: nextAttacker === "B" },
        ],
      },
    },
    include: { teamStates: true },
  });

  // Check if game should end (either team reached A)
  const gameOver = newLevelA === "A" || newLevelB === "A";

  // If winner team is at A and was already at A before, game might be over
  const teamAWon = newLevelA === "A" && attackerWon && attackerTeam === "A";
  const teamBWon = newLevelB === "A" && attackerWon && attackerTeam === "B";

  if (teamAWon || teamBWon) {
    await prisma.game.update({
      where: { id: gameId },
      data: { status: "finished", finishedAt: new Date() },
    });
  }

  return NextResponse.json({ round, gameOver: teamAWon || teamBWon });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: gameId } = await params;

  // Delete the last round (undo)
  const lastRound = await prisma.round.findFirst({
    where: { gameId },
    orderBy: { roundNumber: "desc" },
  });

  if (!lastRound || lastRound.roundNumber === 0) {
    return NextResponse.json({ error: "没有可撤销的记录" }, { status: 400 });
  }

  await prisma.teamState.deleteMany({ where: { roundId: lastRound.id } });
  await prisma.round.delete({ where: { id: lastRound.id } });

  // Restore active status if game was finished
  await prisma.game.update({
    where: { id: gameId },
    data: { status: "active", finishedAt: null },
  });

  return NextResponse.json({ success: true });
}
