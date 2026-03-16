"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, LogOut, Loader2, ChevronRight } from "lucide-react";

interface User {
  id: string;
  username: string;
  avatar: string;
}

interface TeamState {
  team: string;
  currentLevel: string;
  isAttacker: boolean;
}

interface Round {
  id: string;
  roundNumber: number;
  teamStates: TeamState[];
}

interface GamePlayer {
  team: string;
  user: User;
}

interface Game {
  id: string;
  name: string;
  status: string;
  baseScore: number;
  createdAt: string;
  players: GamePlayer[];
  rounds: Round[];
}

const BASE_SCORES = ["5", "10", "20", "50"];

export default function GamesPage() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  const [games, setGames] = useState<Game[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Create game form state
  const [gameName, setGameName] = useState("");
  const [baseScore, setBaseScore] = useState("10");
  const [teamA, setTeamA] = useState<string[]>([]);
  const [teamB, setTeamB] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const fetchGames = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/games", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      const data = await res.json();
      setGames(Array.isArray(data) ? data : []);
    } catch {
      toast.error("加载游戏列表失败");
    } finally {
      setLoading(false);
    }
  }, [token, logout, router]);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setAllUsers(Array.isArray(data) ? data : []);
    } catch {
      // silently ignore
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    fetchGames();
    fetchUsers();
  }, [token, router, fetchGames, fetchUsers]);

  function toggleTeamPlayer(userId: string, team: "A" | "B") {
    if (team === "A") {
      if (teamA.includes(userId)) {
        setTeamA(teamA.filter((id) => id !== userId));
      } else {
        setTeamB(teamB.filter((id) => id !== userId));
        setTeamA([...teamA, userId]);
      }
    } else {
      if (teamB.includes(userId)) {
        setTeamB(teamB.filter((id) => id !== userId));
      } else {
        setTeamA(teamA.filter((id) => id !== userId));
        setTeamB([...teamB, userId]);
      }
    }
  }

  async function handleCreateGame() {
    // Auto-add self to team A if not already selected
    const finalTeamA = teamA.includes(user!.id) || teamB.includes(user!.id)
      ? teamA
      : [user!.id, ...teamA];
    const finalTeamB = teamB;

    setCreating(true);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: gameName.trim() || undefined,
          baseScore: parseInt(baseScore),
          teamA: finalTeamA.length > 0 ? finalTeamA : [user!.id],
          teamB: finalTeamB.length > 0 ? finalTeamB : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "创建失败");
        return;
      }
      toast.success("游戏创建成功！");
      setDialogOpen(false);
      resetForm();
      router.push(`/room/${data.id}`);
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setCreating(false);
    }
  }

  function resetForm() {
    setGameName("");
    setBaseScore("10");
    setTeamA([]);
    setTeamB([]);
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  function getLastRoundStates(game: Game): { teamA: TeamState | null; teamB: TeamState | null } {
    if (!game.rounds || game.rounds.length === 0) {
      return { teamA: null, teamB: null };
    }
    const lastRound = game.rounds[game.rounds.length - 1];
    const stateA = lastRound.teamStates?.find((s) => s.team === "A") ?? null;
    const stateB = lastRound.teamStates?.find((s) => s.team === "B") ?? null;
    return { teamA: stateA, teamB: stateB };
  }

  function getPlayersByTeam(game: Game, team: "A" | "B") {
    return game.players.filter((p) => p.team === team).map((p) => p.user);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-emerald-500" />
          <p className="text-zinc-400 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 to-zinc-800">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 bg-zinc-900/90 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🃏</span>
            <h1 className="text-lg font-bold text-white tracking-tight">升级计分</h1>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="text-base">{user.avatar}</span>
                <span className="hidden sm:inline">{user.username}</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <LogOut className="size-4 mr-1" />
              <span className="hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Page Title + Create Button */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">游戏列表</h2>
            <p className="text-zinc-500 text-sm mt-0.5">{games.length} 场游戏</p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger
              render={
                <Button className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold gap-1.5" />
              }
            >
              <Plus className="size-4" />
              新建游戏
            </DialogTrigger>

            <DialogContent className="bg-zinc-900 ring-1 ring-white/10 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-white text-base">新建游戏</DialogTitle>
              </DialogHeader>

              <div className="flex flex-col gap-5 py-1">
                {/* Game Name */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-zinc-300 text-sm">游戏名称（可选）</Label>
                  <Input
                    placeholder="留空自动生成"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:border-emerald-500 h-9"
                  />
                </div>

                {/* Base Score */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-zinc-300 text-sm">底分</Label>
                  <div className="flex gap-2">
                    {BASE_SCORES.map((score) => (
                      <button
                        key={score}
                        type="button"
                        onClick={() => setBaseScore(score)}
                        className={`flex-1 h-9 rounded-lg text-sm font-medium transition-all ${
                          baseScore === score
                            ? "bg-emerald-600 text-white ring-2 ring-emerald-500"
                            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 ring-1 ring-zinc-700"
                        }`}
                      >
                        {score}分
                      </button>
                    ))}
                  </div>
                </div>

                {/* Info */}
                <div className="bg-zinc-800/60 rounded-lg px-4 py-3 text-sm text-zinc-400">
                  🤖 空缺位置由 <span className="text-emerald-400 font-medium">AI玩家</span> 自动填补。
                  如果有朋友要加入，可以在房间内分享邀请链接。
                </div>
              </div>

              <DialogFooter className="mt-2">
                <Button
                  onClick={handleCreateGame}
                  disabled={creating}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50 h-9"
                >
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      创建中...
                    </span>
                  ) : (
                    "创建游戏"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Games List */}
        {games.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="text-6xl opacity-40">🃏</div>
            <div className="text-center">
              <p className="text-zinc-400 font-medium">还没有游戏记录</p>
              <p className="text-zinc-600 text-sm mt-1">点击"新建游戏"开始你的第一局</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {games.map((game) => {
              const { teamA: stateA, teamB: stateB } = getLastRoundStates(game);
              const playersA = getPlayersByTeam(game, "A");
              const playersB = getPlayersByTeam(game, "B");
              const isFinished = game.status === "finished";

              return (
                <Card
                  key={game.id}
                  className="bg-zinc-800/60 ring-1 ring-white/8 hover:ring-white/15 hover:bg-zinc-800/80 transition-all cursor-pointer active:scale-[0.99]"
                  onClick={() => router.push(`/room/${game.id}`)}
                >
                  <CardHeader className="pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-white text-base leading-tight">{game.name}</CardTitle>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          variant={isFinished ? "secondary" : "default"}
                          className={isFinished
                            ? "bg-zinc-700 text-zinc-400"
                            : "bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-500/30"
                          }
                        >
                          {isFinished ? "已结束" : "进行中"}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-zinc-500 text-xs mt-0.5">底分 {game.baseScore}分</p>
                  </CardHeader>

                  <CardContent className="pt-3">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      {/* Team A */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                          {stateA?.isAttacker && (
                            <span className="text-amber-400 text-xs">👑</span>
                          )}
                          <span className="text-blue-400 text-xs font-semibold">A 队</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {playersA.map((p) => (
                            <span key={p.id} className="text-sm" title={p.username}>
                              {p.avatar}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {playersA.map((p) => (
                            <span key={p.id} className="text-xs text-zinc-400">{p.username}</span>
                          ))}
                        </div>
                        {stateA && (
                          <div className="inline-flex items-center gap-1">
                            <span className="text-amber-400 font-bold text-lg leading-none">{stateA.currentLevel}</span>
                            <span className="text-zinc-500 text-xs">级</span>
                          </div>
                        )}
                      </div>

                      {/* VS */}
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-zinc-600 text-xs font-bold">VS</span>
                      </div>

                      {/* Team B */}
                      <div className="flex flex-col gap-1.5 items-end">
                        <div className="flex items-center gap-1.5 flex-row-reverse">
                          {stateB?.isAttacker && (
                            <span className="text-amber-400 text-xs">👑</span>
                          )}
                          <span className="text-red-400 text-xs font-semibold">B 队</span>
                        </div>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {playersB.map((p) => (
                            <span key={p.id} className="text-sm" title={p.username}>
                              {p.avatar}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {playersB.map((p) => (
                            <span key={p.id} className="text-xs text-zinc-400">{p.username}</span>
                          ))}
                        </div>
                        {stateB && (
                          <div className="inline-flex items-center gap-1">
                            <span className="text-amber-400 font-bold text-lg leading-none">{stateB.currentLevel}</span>
                            <span className="text-zinc-500 text-xs">级</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end mt-3 pt-3 border-t border-white/5">
                      <span className="text-zinc-500 text-xs flex items-center gap-0.5">
                        查看详情 <ChevronRight className="size-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
