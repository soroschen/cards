"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Plus, RotateCcw, Crown, Trophy, Swords } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  avatar: string;
}

interface GamePlayer {
  team: string;
  seatOrder: number;
  user: User;
}

interface TeamState {
  id: string;
  team: string;
  currentLevel: string;
  isAttacker: boolean;
}

interface Round {
  id: string;
  roundNumber: number;
  attackerTeam: string;
  winnerTeam: string;
  levelChange: number;
  isDoubled: boolean;
  note: string | null;
  teamStates: TeamState[];
  recordedBy: string;
}

interface Game {
  id: string;
  name: string;
  status: string;
  baseScore: number;
  createdAt: string;
  finishedAt: string | null;
  players: GamePlayer[];
  rounds: Round[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLastRound(game: Game): Round | null {
  if (!game.rounds || game.rounds.length === 0) return null;
  return game.rounds[game.rounds.length - 1];
}

function getTeamState(round: Round | null, team: "A" | "B"): TeamState | null {
  if (!round) return null;
  return round.teamStates.find((s) => s.team === team) ?? null;
}

function levelLabel(level: string) {
  return level;
}

const LEVEL_CHANGE_OPTIONS = [1, 2, 3];

// ─── Component ───────────────────────────────────────────────────────────────

export default function GameDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { token } = useAuth();
  const gameId = params.id as string;

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);

  // Round form state
  const [attackerTeam, setAttackerTeam] = useState<"A" | "B">("A");
  const [winnerTeam, setWinnerTeam] = useState<"A" | "B">("A");
  const [winnerIsAttacker, setWinnerIsAttacker] = useState<boolean>(true); // true=攻方赢, false=守方赢
  const [levelChange, setLevelChange] = useState(1);
  const [isDoubled, setIsDoubled] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [ending, setEnding] = useState(false);

  const fetchGame = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/games/${gameId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.status === 404) {
        toast.error("游戏不存在");
        router.replace("/games");
        return;
      }
      const data = await res.json();
      setGame(data);

      // Set default attacker from last round
      const last = data.rounds?.[data.rounds.length - 1];
      if (last) {
        const attacker = last.teamStates.find((s: TeamState) => s.isAttacker);
        if (attacker) {
          setAttackerTeam(attacker.team as "A" | "B");
        }
      }
    } catch {
      toast.error("加载游戏失败");
    } finally {
      setLoading(false);
    }
  }, [token, gameId, router]);

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    fetchGame();
  }, [token, router, fetchGame]);

  // When attacker changes, reset winner accordingly
  useEffect(() => {
    const newWinner = winnerIsAttacker ? attackerTeam : (attackerTeam === "A" ? "B" : "A");
    setWinnerTeam(newWinner as "A" | "B");
  }, [attackerTeam, winnerIsAttacker]);

  async function handleRecordRound() {
    if (!game) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/${gameId}/rounds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          attackerTeam,
          winnerTeam,
          levelChange,
          isDoubled,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "记录失败");
        return;
      }
      toast.success("本局已记录");
      setRecordDialogOpen(false);
      resetRoundForm();
      await fetchGame();
      if (data.gameOver) {
        toast.success("游戏结束！", { description: "恭喜胜方！" });
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUndo() {
    if (!game) return;
    setUndoing(true);
    try {
      const res = await fetch(`/api/games/${gameId}/rounds`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "撤销失败");
        return;
      }
      toast.success("已撤销上一局");
      await fetchGame();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setUndoing(false);
    }
  }

  async function handleEndGame() {
    if (!game) return;
    setEnding(true);
    try {
      const res = await fetch(`/api/games/${gameId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: "finished" }),
      });
      if (!res.ok) {
        toast.error("操作失败");
        return;
      }
      toast.success("游戏已结束");
      setEndDialogOpen(false);
      await fetchGame();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setEnding(false);
    }
  }

  function resetRoundForm() {
    setLevelChange(1);
    setIsDoubled(false);
    setNote("");
    setWinnerIsAttacker(true);
  }

  function openRecordDialog() {
    resetRoundForm();
    // Pre-fill attacker from last round
    const last = getLastRound(game!);
    if (last) {
      const attacker = last.teamStates.find((s) => s.isAttacker);
      if (attacker) setAttackerTeam(attacker.team as "A" | "B");
    }
    setWinnerIsAttacker(true);
    setRecordDialogOpen(true);
  }

  if (loading || !game) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-emerald-500" />
          <p className="text-zinc-400 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  const lastRound = getLastRound(game);
  const stateA = getTeamState(lastRound, "A");
  const stateB = getTeamState(lastRound, "B");
  const playersA = game.players.filter((p) => p.team === "A").sort((a, b) => a.seatOrder - b.seatOrder);
  const playersB = game.players.filter((p) => p.team === "B").sort((a, b) => a.seatOrder - b.seatOrder);
  const isFinished = game.status === "finished";
  const actualRounds = game.rounds.filter((r) => r.roundNumber > 0);

  // Determine winner for finished games
  let winner: "A" | "B" | null = null;
  if (isFinished && stateA && stateB) {
    if (stateA.currentLevel === "A") winner = "A";
    else if (stateB.currentLevel === "A") winner = "B";
    else {
      // Manually ended — higher level wins, or last winner
      const LEVELS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
      const idxA = LEVELS.indexOf(stateA.currentLevel);
      const idxB = LEVELS.indexOf(stateB.currentLevel);
      winner = idxA >= idxB ? "A" : "B";
    }
  }

  // Compute what winner team would be for dialog
  const dialogWinnerTeam: "A" | "B" = winnerIsAttacker
    ? attackerTeam
    : (attackerTeam === "A" ? "B" : "A");

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 to-zinc-800 pb-8">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-zinc-900/90 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/games")}
            className="text-zinc-400 hover:text-white hover:bg-zinc-800 shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-white truncate">{game.name}</h1>
            <p className="text-zinc-500 text-xs">底分 {game.baseScore}分</p>
          </div>
          {!isFinished && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEndDialogOpen(true)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white shrink-0 text-xs"
            >
              结束游戏
            </Button>
          )}
          {isFinished && (
            <Badge className="bg-zinc-700 text-zinc-400 shrink-0">已结束</Badge>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 flex flex-col gap-5">
        {/* Winner Banner */}
        {isFinished && winner && (
          <div className={`
            rounded-xl p-4 text-center ring-2 flex flex-col items-center gap-2
            ${winner === "A"
              ? "bg-blue-900/40 ring-blue-500/50"
              : "bg-red-900/40 ring-red-500/50"
            }
          `}>
            <Trophy className={`size-8 ${winner === "A" ? "text-blue-400" : "text-red-400"}`} />
            <div>
              <p className={`text-lg font-bold ${winner === "A" ? "text-blue-300" : "text-red-300"}`}>
                {winner === "A" ? "A 队" : "B 队"} 获胜！
              </p>
              <p className="text-zinc-400 text-sm mt-0.5">游戏已结束</p>
            </div>
          </div>
        )}

        {/* Score Panel */}
        <div className="bg-zinc-800/60 ring-1 ring-white/8 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_1fr]">
            {/* Team A */}
            <div className={`
              p-4 flex flex-col items-center gap-3
              ${stateA?.isAttacker ? "bg-amber-500/5" : ""}
            `}>
              {/* Attacker badge */}
              <div className="h-5 flex items-center">
                {stateA?.isAttacker && (
                  <span className="flex items-center gap-1 bg-amber-500/20 text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full ring-1 ring-amber-500/30">
                    <Crown className="size-3" />
                    庄
                  </span>
                )}
              </div>

              {/* Team label */}
              <span className="text-blue-400 text-xs font-bold tracking-widest">A 队</span>

              {/* Players */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex gap-1 flex-wrap justify-center">
                  {playersA.map((p) => (
                    <span key={p.user.id} className="text-2xl" title={p.user.username}>
                      {p.user.avatar}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 justify-center">
                  {playersA.map((p) => (
                    <span key={p.user.id} className="text-xs text-zinc-400">{p.user.username}</span>
                  ))}
                </div>
              </div>

              {/* Level display — playing card style */}
              <div className="flex flex-col items-center gap-1 mt-1">
                <div className="bg-zinc-900 ring-2 ring-amber-500/40 rounded-lg px-4 py-2 text-center min-w-[64px]">
                  <span className="text-amber-400 font-black text-3xl leading-none">
                    {stateA?.currentLevel ?? "2"}
                  </span>
                </div>
                <span className="text-zinc-500 text-xs">当前级牌</span>
              </div>
            </div>

            {/* Divider / VS */}
            <div className="flex flex-col items-center justify-center px-2 gap-2 border-x border-white/5">
              <Swords className="size-5 text-zinc-600" />
            </div>

            {/* Team B */}
            <div className={`
              p-4 flex flex-col items-center gap-3
              ${stateB?.isAttacker ? "bg-amber-500/5" : ""}
            `}>
              {/* Attacker badge */}
              <div className="h-5 flex items-center">
                {stateB?.isAttacker && (
                  <span className="flex items-center gap-1 bg-amber-500/20 text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full ring-1 ring-amber-500/30">
                    <Crown className="size-3" />
                    庄
                  </span>
                )}
              </div>

              {/* Team label */}
              <span className="text-red-400 text-xs font-bold tracking-widest">B 队</span>

              {/* Players */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex gap-1 flex-wrap justify-center">
                  {playersB.map((p) => (
                    <span key={p.user.id} className="text-2xl" title={p.user.username}>
                      {p.user.avatar}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 justify-center">
                  {playersB.map((p) => (
                    <span key={p.user.id} className="text-xs text-zinc-400">{p.user.username}</span>
                  ))}
                </div>
              </div>

              {/* Level display */}
              <div className="flex flex-col items-center gap-1 mt-1">
                <div className="bg-zinc-900 ring-2 ring-amber-500/40 rounded-lg px-4 py-2 text-center min-w-[64px]">
                  <span className="text-amber-400 font-black text-3xl leading-none">
                    {stateB?.currentLevel ?? "2"}
                  </span>
                </div>
                <span className="text-zinc-500 text-xs">当前级牌</span>
              </div>
            </div>
          </div>

          {/* Round count footer */}
          <div className="border-t border-white/5 px-4 py-2.5 flex items-center justify-between">
            <span className="text-zinc-500 text-xs">共 {actualRounds.length} 局</span>
            {!isFinished && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndo}
                  disabled={undoing || actualRounds.length === 0}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-700 h-7 px-2 text-xs gap-1 disabled:opacity-30"
                >
                  {undoing ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  撤销上一局
                </Button>
                <Button
                  size="sm"
                  onClick={openRecordDialog}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-7 px-3 text-xs gap-1"
                >
                  <Plus className="size-3" />
                  记录本局
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Round History */}
        {actualRounds.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider px-0.5">对局记录</h3>
            <div className="flex flex-col gap-2">
              {[...actualRounds].reverse().map((round) => {
                const rStateA = round.teamStates.find((s) => s.team === "A");
                const rStateB = round.teamStates.find((s) => s.team === "B");
                const attackerLabel = round.attackerTeam === "A" ? "A 队(庄)" : "B 队(庄)";
                const winnerLabel = round.winnerTeam === "A" ? "A 队" : "B 队";
                const isWinnerA = round.winnerTeam === "A";

                return (
                  <div
                    key={round.id}
                    className="bg-zinc-800/40 ring-1 ring-white/6 rounded-lg px-4 py-3 flex items-center gap-3"
                  >
                    {/* Round number */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-700/60 flex items-center justify-center">
                      <span className="text-zinc-400 text-xs font-bold">{round.roundNumber}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-zinc-300 text-sm font-medium">
                          {attackerLabel} 出庄
                        </span>
                        <span className="text-zinc-600 text-xs">→</span>
                        <span className={`text-sm font-semibold ${isWinnerA ? "text-blue-400" : "text-red-400"}`}>
                          {winnerLabel} 胜
                        </span>
                        {round.isDoubled && (
                          <Badge className="bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30 text-xs h-4 px-1.5">
                            翻倍
                          </Badge>
                        )}
                      </div>
                      {round.note && (
                        <p className="text-zinc-500 text-xs mt-0.5 truncate">{round.note}</p>
                      )}
                    </div>

                    {/* Level after round */}
                    <div className="shrink-0 flex items-center gap-2 text-xs text-zinc-500">
                      <span className="text-blue-400 font-bold">{rStateA?.currentLevel}</span>
                      <span>/</span>
                      <span className="text-red-400 font-bold">{rStateB?.currentLevel}</span>
                      {round.levelChange > 0 && (
                        <span className="text-emerald-500 font-semibold">+{round.levelChange}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {actualRounds.length === 0 && !isFinished && (
          <div className="flex flex-col items-center py-10 gap-3">
            <div className="text-4xl opacity-40">🃏</div>
            <p className="text-zinc-500 text-sm">还没有对局记录</p>
            <Button
              onClick={openRecordDialog}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              <Plus className="size-4 mr-1" />
              记录第一局
            </Button>
          </div>
        )}
      </main>

      {/* ── Record Round Dialog ── */}
      <Dialog open={recordDialogOpen} onOpenChange={setRecordDialogOpen}>
        <DialogContent className="bg-zinc-900 ring-1 ring-white/10 max-w-md w-full">
          <DialogHeader>
            <DialogTitle className="text-white text-base">记录本局</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-1">
            {/* Attacker Team */}
            <div className="flex flex-col gap-2">
              <Label className="text-zinc-300 text-sm flex items-center gap-1.5">
                <Crown className="size-3.5 text-amber-400" />
                出庄方（庄家）
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {(["A", "B"] as const).map((team) => (
                  <button
                    key={team}
                    type="button"
                    onClick={() => setAttackerTeam(team)}
                    className={`
                      py-2.5 rounded-lg text-sm font-semibold transition-all
                      ${attackerTeam === team
                        ? team === "A"
                          ? "bg-blue-600 text-white ring-2 ring-blue-400"
                          : "bg-red-600 text-white ring-2 ring-red-400"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 ring-1 ring-zinc-700"
                      }
                    `}
                  >
                    {team === "A" ? "A 队 (庄)" : "B 队 (庄)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Winner */}
            <div className="flex flex-col gap-2">
              <Label className="text-zinc-300 text-sm">本局胜者</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWinnerIsAttacker(true)}
                  className={`
                    py-2.5 rounded-lg text-sm font-semibold transition-all
                    ${winnerIsAttacker
                      ? "bg-emerald-700 text-white ring-2 ring-emerald-500"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 ring-1 ring-zinc-700"
                    }
                  `}
                >
                  攻方赢
                </button>
                <button
                  type="button"
                  onClick={() => setWinnerIsAttacker(false)}
                  className={`
                    py-2.5 rounded-lg text-sm font-semibold transition-all
                    ${!winnerIsAttacker
                      ? "bg-emerald-700 text-white ring-2 ring-emerald-500"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 ring-1 ring-zinc-700"
                    }
                  `}
                >
                  守方赢
                </button>
              </div>
              <p className="text-zinc-500 text-xs">
                胜者：
                <span className={`font-semibold ml-1 ${dialogWinnerTeam === "A" ? "text-blue-400" : "text-red-400"}`}>
                  {dialogWinnerTeam === "A" ? "A 队" : "B 队"}
                </span>
                &nbsp;升级
              </p>
            </div>

            {/* Level Change */}
            <div className="flex flex-col gap-2">
              <Label className="text-zinc-300 text-sm">升级步数</Label>
              <div className="grid grid-cols-3 gap-2">
                {LEVEL_CHANGE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setLevelChange(n)}
                    className={`
                      py-2.5 rounded-lg font-bold text-base transition-all
                      ${levelChange === n
                        ? "bg-amber-600/80 text-white ring-2 ring-amber-500"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 ring-1 ring-zinc-700"
                      }
                    `}
                  >
                    +{n}
                  </button>
                ))}
              </div>
              <p className="text-zinc-500 text-xs">
                胜方当前级：
                <span className="text-amber-400 font-bold ml-1">
                  {dialogWinnerTeam === "A" ? stateA?.currentLevel : stateB?.currentLevel}
                </span>
                &nbsp;→&nbsp;升 {levelChange} 步
              </p>
            </div>

            {/* Double */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsDoubled(!isDoubled)}
                className={`
                  relative inline-flex h-6 w-11 shrink-0 rounded-full transition-all
                  ${isDoubled ? "bg-amber-500" : "bg-zinc-700"}
                `}
                role="switch"
                aria-checked={isDoubled}
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform
                    ${isDoubled ? "translate-x-5" : "translate-x-0"}
                  `}
                />
              </button>
              <Label className="text-zinc-300 text-sm cursor-pointer" onClick={() => setIsDoubled(!isDoubled)}>
                翻倍
                {isDoubled && <span className="ml-1.5 text-amber-400 text-xs">（已开启）</span>}
              </Label>
            </div>

            {/* Note */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-zinc-300 text-sm">备注（可选）</Label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：大牌局、打了对王..."
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 resize-none outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              onClick={handleRecordRound}
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50 h-9"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  提交中...
                </span>
              ) : (
                "确认记录"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── End Game Confirmation Dialog ── */}
      <Dialog open={endDialogOpen} onOpenChange={setEndDialogOpen}>
        <DialogContent className="bg-zinc-900 ring-1 ring-white/10 max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="text-white text-base">结束游戏</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-400 text-sm py-1">
            确定要结束这场游戏吗？结束后将无法继续记录新对局。
          </p>
          <DialogFooter className="mt-2">
            <Button
              onClick={handleEndGame}
              disabled={ending}
              className="w-full bg-red-700 hover:bg-red-600 text-white font-semibold disabled:opacity-50 h-9"
            >
              {ending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  处理中...
                </span>
              ) : (
                "确认结束"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
