import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, avatar: true },
    orderBy: { username: "asc" },
  });
  return NextResponse.json(users);
}
