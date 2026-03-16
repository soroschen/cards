'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/lib/store'
import { getSocket, disconnectSocket } from '@/lib/socket-client'
import type { Card, TrumpInfo } from '@/lib/cards'
import { isTrump, getSuit, getCardRank, sortHand, getCardDisplay, countPoints, isValidPlay, getComboLabel } from '@/lib/cards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Crown, Loader2, Wifi, WifiOff } from 'lucide-react'

// ─── Responsive hook ──────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}

// ─── Types matching server game-engine ────────────────────────────────────────

type GamePhase = 'waiting' | 'dealing' | 'declaring' | 'exchanging' | 'playing' | 'scoring' | 'finished'

interface PlayerState {
  userId: string
  username: string
  avatar: string
  team: 'A' | 'B'
  hand: (Card | { id: 'hidden'; hidden: true })[]
  connected: boolean
  seatIndex: number
}

interface TrumpDeclaration {
  playerId: string
  cards: Card[]
  suit: string
  strength: number
}

interface Trick {
  leadPlayerId: string
  plays: { playerId: string; cards: Card[] }[]
  winnerId?: string
}

interface GameState {
  id: string
  phase: GamePhase
  players: PlayerState[]
  currentLevel: { A: string; B: string }
  currentAttacker: 'A' | 'B'
  trump: TrumpInfo
  kitty: Card[]
  currentTrick: Trick | null
  completedTricks: Trick[]
  collectedPoints: { A: number; B: number }
  currentTurnPlayerId: string | null
  declarationWindow: boolean
  currentDeclaration: TrumpDeclaration | null
  landlordPlayerId: string | null
  roundNumber: number
  message: string
}

interface GameEvent {
  message: string
  timestamp: number
}

// ─── Card component ───────────────────────────────────────────────────────────

interface CardProps {
  card: Card
  selected?: boolean
  onClick?: () => void
  isTrumpCard?: boolean
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}

function CardComponent({ card, selected, onClick, isTrumpCard, size = 'md', disabled }: CardProps) {
  const { label, color } = getCardDisplay(card)
  const isJoker = card.suit === 'joker'
  const isRed = color.includes('red')

  const sizes = {
    sm: 'w-9 h-14 text-xs',
    md: 'w-12 h-18 text-sm',
    lg: 'w-14 h-20 text-base',
  }

  const cornerSize = {
    sm: 'text-[9px]',
    md: 'text-[11px]',
    lg: 'text-xs',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative rounded-lg border-2 bg-white shadow-md
        flex flex-col items-center justify-between p-1
        transition-all duration-150 select-none
        ${sizes[size]}
        ${selected
          ? 'border-emerald-400 ring-2 ring-emerald-400/60 -translate-y-3 shadow-emerald-500/30 shadow-lg'
          : 'border-zinc-200 hover:border-zinc-400 hover:-translate-y-1'
        }
        ${isTrumpCard ? 'ring-1 ring-amber-400/50 bg-amber-50' : ''}
        ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {/* Top-left corner */}
      <div className={`self-start ${color} font-bold leading-none ${cornerSize[size]}`}>
        {isJoker ? (card.value === 'big' ? '大' : '小') : label.replace(card.suit, '')}
        {!isJoker && (
          <div className={`${color} leading-none`}>{card.suit}</div>
        )}
      </div>

      {/* Center symbol */}
      <div className={`${color} font-black leading-none ${size === 'sm' ? 'text-base' : size === 'md' ? 'text-xl' : 'text-2xl'}`}>
        {isJoker
          ? (card.value === 'big' ? '🃟' : '🃏')
          : card.suit}
      </div>

      {/* Bottom-right corner (rotated) */}
      <div className={`self-end ${color} font-bold leading-none ${cornerSize[size]} rotate-180`}>
        {isJoker ? (card.value === 'big' ? '大' : '小') : label.replace(card.suit, '')}
        {!isJoker && (
          <div className={`${color} leading-none`}>{card.suit}</div>
        )}
      </div>

      {/* Point badge */}
      {card.points > 0 && (
        <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none shadow">
          {card.points}
        </div>
      )}
    </button>
  )
}

// ─── Card back component ──────────────────────────────────────────────────────

function CardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-9 h-14', md: 'w-12 h-18', lg: 'w-14 h-20' }
  return (
    <div className={`${sizes[size]} rounded-lg border-2 border-blue-700 bg-gradient-to-br from-blue-800 to-blue-900 shadow-md flex items-center justify-center`}>
      <div className="w-6 h-8 rounded border border-blue-600/50 bg-blue-700/50 flex items-center justify-center text-blue-300/80 text-xs font-bold">
        🂠
      </div>
    </div>
  )
}

// ─── Opponent hand ────────────────────────────────────────────────────────────

function OpponentHand({
  player,
  position,
  isLandlord,
  isCurrentTurn,
  currentTrick,
}: {
  player: PlayerState
  position: 'top' | 'left' | 'right'
  isLandlord: boolean
  isCurrentTurn: boolean
  currentTrick: Trick | null
}) {
  const count = player.hand.length
  const play = currentTrick?.plays.find(p => p.playerId === player.userId)

  const isHorizontal = position === 'top'

  return (
    <div className={`flex flex-col items-center gap-1 ${position === 'left' ? 'flex-col' : position === 'right' ? 'flex-col' : ''}`}>
      {/* Player info */}
      <div className={`flex items-center gap-1.5 ${isCurrentTurn ? 'opacity-100' : 'opacity-70'}`}>
        <span className="text-lg">{player.avatar}</span>
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-zinc-300">{player.username}</span>
            {isLandlord && (
              <span className="bg-amber-500/20 text-amber-400 text-[10px] font-semibold px-1 rounded ring-1 ring-amber-500/30">庄</span>
            )}
            {!player.connected && <WifiOff className="w-3 h-3 text-red-400" />}
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-xs font-bold ${player.team === 'A' ? 'text-blue-400' : 'text-red-400'}`}>
              {player.team}队
            </span>
            {isCurrentTurn && (
              <span className="text-[10px] text-emerald-400 font-medium animate-pulse">出牌中</span>
            )}
          </div>
        </div>
      </div>

      {/* Cards played in current trick */}
      {play && (
        <div className="flex gap-1 flex-wrap justify-center max-w-32">
          {play.cards.map(c => (
            <CardComponent key={c.id} card={c} size="sm" />
          ))}
        </div>
      )}

      {/* Card backs */}
      {!play && (
        <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} items-center`}>
          <div className="flex flex-wrap gap-0.5 justify-center max-w-40">
            {Array.from({ length: Math.min(count, isHorizontal ? 10 : 6) }).map((_, i) => (
              <CardBack key={i} size="sm" />
            ))}
            {count > (isHorizontal ? 10 : 6) && (
              <div className="w-9 h-14 rounded-lg bg-zinc-700 border-2 border-zinc-600 flex items-center justify-center text-zinc-400 text-xs font-bold">
                +{count - (isHorizontal ? 10 : 6)}
              </div>
            )}
          </div>
          <Badge className="bg-zinc-700 text-zinc-300 text-xs ml-1">{count}张</Badge>
        </div>
      )}
    </div>
  )
}

// ─── Player slot (always-visible seat at each position) ───────────────────────

interface PlayerSlotProps {
  player: PlayerState | undefined
  position: 'top' | 'left' | 'right'
  isLandlord: boolean
  isCurrentTurn: boolean
  playedCards: Card[]
  label: string
}

function PlayerSlot({ player, position, isLandlord, isCurrentTurn, playedCards, label }: PlayerSlotProps) {
  const isVertical = position === 'left' || position === 'right'
  const count = player?.hand.length ?? 0

  return (
    <div
      className={`
        flex flex-col items-center gap-2
        bg-zinc-800/60 rounded-2xl p-2
        ring-1 transition-all duration-300
        ${isCurrentTurn
          ? 'ring-emerald-500/70 shadow-lg shadow-emerald-900/40'
          : 'ring-zinc-700/40'
        }
        ${position === 'top' ? 'min-w-[120px]' : 'min-w-[88px]'}
      `}
    >
      {/* Avatar + name row */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="relative">
          <span className="text-2xl leading-none">{player?.avatar ?? '🪑'}</span>
          {isLandlord && (
            <span className="absolute -top-1 -right-2 bg-amber-500/90 text-white text-[8px] font-bold px-1 rounded-full leading-tight shadow">
              庄
            </span>
          )}
        </div>
        <span
          className={`text-xs font-semibold leading-tight text-center truncate max-w-[72px] ${
            player
              ? player.team === 'A'
                ? 'text-blue-300'
                : 'text-red-300'
              : 'text-zinc-600'
          }`}
        >
          {player?.username ?? label}
        </span>
        {player && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">{count}张</span>
            {!player.connected && <WifiOff className="w-2.5 h-2.5 text-red-400" />}
            {isCurrentTurn && (
              <span className="text-[9px] text-emerald-400 font-medium animate-pulse">●</span>
            )}
          </div>
        )}
      </div>

      {/* Card backs (compact) */}
      {player && count > 0 && playedCards.length === 0 && (
        <div className={`flex ${position === 'top' ? 'flex-row' : 'flex-col'} gap-0.5 justify-center items-center`}>
          {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
            <CardBack key={i} size="sm" />
          ))}
          {count > 3 && (
            <div className="w-9 h-14 rounded-lg bg-zinc-700 border-2 border-zinc-600 flex items-center justify-center text-zinc-300 text-xs font-bold">
              +{count - 3}
            </div>
          )}
        </div>
      )}

      {/* Empty seat placeholder */}
      {!player && (
        <div className="w-full h-14 rounded-xl border-2 border-dashed border-zinc-700/50 flex items-center justify-center">
          <span className="text-zinc-700 text-xs">空位</span>
        </div>
      )}

      {/* Played cards this trick */}
      {playedCards.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center animate-in fade-in zoom-in-95 duration-200">
          {playedCards.map(c => (
            <CardComponent key={c.id} card={c} size="sm" />
          ))}
        </div>
      )}

      {/* Empty played-cards placeholder when player exists but hasn't played */}
      {player && count > 0 && playedCards.length === 0 && (
        <div className="w-full h-8 rounded-lg border border-dashed border-zinc-700/40 flex items-center justify-center">
          <span className="text-zinc-700 text-[10px]">未出牌</span>
        </div>
      )}
    </div>
  )
}

// ─── Game info panel ──────────────────────────────────────────────────────────

function GameInfoPanel({
  state,
  myPlayer,
}: {
  state: GameState
  myPlayer: PlayerState | undefined
}) {
  return (
    <div className="bg-zinc-800/80 rounded-xl p-3 flex flex-col gap-2 text-sm min-w-36">
      {/* Phase */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-500 text-xs">阶段</span>
        <PhaseLabel phase={state.phase} />
      </div>

      {/* Trump */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-500 text-xs">主牌</span>
        <span className="font-bold text-amber-400">
          {state.trump.suit
            ? state.trump.suit === 'joker'
              ? `${state.trump.level} 无主`
              : `${state.trump.level}${state.trump.suit}`
            : `${state.trump.level} 待叫`}
        </span>
      </div>

      {/* Level */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-blue-400 font-bold text-xs">A: {state.currentLevel.A}</span>
        <span className="text-zinc-600 text-xs">vs</span>
        <span className="text-red-400 font-bold text-xs">B: {state.currentLevel.B}</span>
      </div>

      {/* Points */}
      {(state.phase === 'playing' || state.phase === 'scoring') && (
        <div className="border-t border-zinc-700 pt-2 flex flex-col gap-1">
          <span className="text-zinc-500 text-[10px]">得分</span>
          <div className="flex justify-between text-xs">
            <span className="text-blue-400">A: {state.collectedPoints.A}分</span>
            <span className="text-red-400">B: {state.collectedPoints.B}分</span>
          </div>
        </div>
      )}

      {/* Round */}
      <div className="border-t border-zinc-700 pt-2">
        <span className="text-zinc-500 text-[10px]">第 {state.roundNumber} 局</span>
      </div>
    </div>
  )
}

function PhaseLabel({ phase }: { phase: GamePhase }) {
  const labels: Record<GamePhase, { text: string; color: string }> = {
    waiting:    { text: '等待', color: 'text-zinc-400' },
    dealing:    { text: '发牌', color: 'text-blue-400' },
    declaring:  { text: '叫主', color: 'text-amber-400' },
    exchanging: { text: '换底', color: 'text-purple-400' },
    playing:    { text: '出牌', color: 'text-emerald-400' },
    scoring:    { text: '结算', color: 'text-orange-400' },
    finished:   { text: '结束', color: 'text-zinc-400' },
  }
  const { text, color } = labels[phase]
  return <span className={`font-semibold text-xs ${color}`}>{text}</span>
}

// ─── Action panel ─────────────────────────────────────────────────────────────

interface ActionPanelProps {
  state: GameState
  myUserId: string
  selectedCards: Card[]
  onDeclareTrump: () => void
  onFinishDeclaring: () => void
  onExchangeKitty: () => void
  onPlayCards: () => void
  onStartGame: () => void
  onNextRound: () => void
}

function ActionPanel({
  state,
  myUserId,
  selectedCards,
  onDeclareTrump,
  onFinishDeclaring,
  onExchangeKitty,
  onPlayCards,
  onStartGame,
  onNextRound,
}: ActionPanelProps) {
  const isMyTurn = state.currentTurnPlayerId === myUserId
  const isLandlord = state.landlordPlayerId === myUserId
  const myPlayer = state.players.find(p => p.userId === myUserId)

  if (state.phase === 'waiting') {
    const isFirst = state.players[0]?.userId === myUserId || state.players.length <= 1
    return (
      <div className="flex flex-col gap-2 items-center">
        <p className="text-zinc-400 text-sm">
          {state.players.length} 名玩家已加入
        </p>
        <Button
          onClick={onStartGame}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-8"
        >
          开始游戏
        </Button>
      </div>
    )
  }

  if (state.phase === 'declaring') {
    const myPlayer = state.players.find(p => p.userId === myUserId)
    const myLevelCards = (myPlayer?.hand ?? []).filter(
      (c): c is Card => !('hidden' in c) && c.value === state.trump.level && c.suit !== 'joker'
    )
    const canDeclare = selectedCards.length === 1 || selectedCards.length === 2
    const declareLabel = selectedCards.length === 2 ? '叫对子' : selectedCards.length === 1 ? '叫单张' : '请选牌叫主'
    const hasLevelCards = myLevelCards.length > 0

    return (
      <div className="flex flex-col gap-2 items-center">
        <p className="text-zinc-500 text-xs">
          {hasLevelCards
            ? `选择级牌（${state.trump.level}）叫主，你有 ${myLevelCards.length} 张`
            : `你没有级牌（${state.trump.level}），无法叫主`}
        </p>
        <div className="flex gap-2">
          {hasLevelCards && (
            <Button
              onClick={onDeclareTrump}
              disabled={!canDeclare}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold"
            >
              {declareLabel}
            </Button>
          )}
          <Button
            onClick={onFinishDeclaring}
            variant="outline"
            className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
          >
            {hasLevelCards ? '跳过' : '过'}
          </Button>
        </div>
        {state.currentDeclaration && (
          <p className="text-amber-400 text-xs">
            当前：{state.players.find(p => p.userId === state.currentDeclaration!.playerId)?.username}
            {' '}叫了 {state.currentDeclaration.suit === 'joker' ? '无主' : state.currentDeclaration.suit}
            （{state.currentDeclaration.strength === 1 ? '单' : state.currentDeclaration.strength === 2 ? '对' : '大牌'}）
          </p>
        )}
      </div>
    )
  }

  if (state.phase === 'exchanging') {
    if (!isLandlord) {
      return (
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          <p className="text-zinc-400 text-sm">等待庄家换底牌...</p>
        </div>
      )
    }
    const kittyCount = state.kitty?.length ?? 8
    const selected8 = selectedCards.length === kittyCount
    return (
      <div className="flex flex-col gap-2 items-center">
        <p className="text-zinc-400 text-sm">
          请从手牌中选 <span className="text-amber-400 font-bold">{kittyCount}</span> 张扣入底牌
          （已选 {selectedCards.length}/{kittyCount}）
        </p>
        <Button
          onClick={onExchangeKitty}
          disabled={!selected8}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold"
        >
          确认换底
        </Button>
      </div>
    )
  }

  if (state.phase === 'playing') {
    if (!isMyTurn) {
      const turnPlayer = state.players.find(p => p.userId === state.currentTurnPlayerId)
      return (
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          <p className="text-zinc-400 text-sm">等待 {turnPlayer?.username ?? '...'} 出牌</p>
        </div>
      )
    }
    const isLeading = (state.currentTrick?.plays.length ?? 0) === 0
    const ledCount = state.currentTrick?.plays[0]?.cards.length ?? 0
    const canPlay = isLeading ? selectedCards.length > 0 : selectedCards.length === ledCount
    return (
      <div className="flex flex-col gap-2 items-center">
        <p className="text-zinc-400 text-xs">
          {isLeading ? '您先出，请选牌' : `请跟牌（${ledCount}张）`}
          {selectedCards.length > 0 && ` — 已选 ${selectedCards.length} 张`}
        </p>
        {/* Combo hint for 甩牌 */}
        {isMyTurn && isLeading && selectedCards.length > 1 && state.trump && (() => {
          const label = getComboLabel(selectedCards, state.trump)
          if (!label) return null
          return (
            <div className={`text-xs font-bold px-3 py-1 rounded-full ring-1 ${
              label === '拖拉机！' ? 'bg-purple-500/20 text-purple-300 ring-purple-500/40' :
              label === '对子' ? 'bg-blue-500/20 text-blue-300 ring-blue-500/40' :
              'bg-amber-500/20 text-amber-300 ring-amber-500/40'
            }`}>
              {label === '甩牌' ? '⚡ 甩牌' : label === '拖拉机！' ? '🔥 拖拉机' : `✌️ ${label}`}
            </div>
          )
        })()}
        <Button
          onClick={onPlayCards}
          disabled={!canPlay}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold px-8"
        >
          出牌
        </Button>
      </div>
    )
  }

  if (state.phase === 'scoring') {
    const result = (() => {
      const defTeam: 'A' | 'B' = state.currentAttacker === 'A' ? 'B' : 'A'
      const defPts = state.collectedPoints[defTeam]
      return { defTeam, defPts, attackerWins: defPts < 80 }
    })()
    return (
      <div className="flex flex-col gap-2 items-center">
        <div className="text-center">
          <p className="text-white font-bold">
            {result.attackerWins ? `庄家队(${state.currentAttacker}队)胜！` : `进攻队(${result.defTeam}队)胜！`}
          </p>
          <p className="text-zinc-400 text-sm">非庄得分：{result.defPts}/200</p>
        </div>
        <Button
          onClick={onNextRound}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
        >
          下一局
        </Button>
      </div>
    )
  }

  if (state.phase === 'finished') {
    return (
      <div className="text-center">
        <p className="text-amber-400 font-bold text-lg">游戏结束！</p>
        <p className="text-zinc-400 text-sm">{state.message}</p>
      </div>
    )
  }

  return null
}

// ─── Event log ────────────────────────────────────────────────────────────────

function EventLog({ events }: { events: GameEvent[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [events])

  return (
    <div ref={ref} className="h-20 overflow-y-auto flex flex-col gap-1 px-2 py-1">
      {events.slice(-20).map((e, i) => (
        <p key={i} className="text-zinc-400 text-xs leading-tight">
          <span className="text-zinc-600">{new Date(e.timestamp).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          {' '}{e.message}
        </p>
      ))}
    </div>
  )
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function RoomPage() {
  const params = useParams()
  const router = useRouter()
  const { user, token } = useAuth()
  const roomId = params.id as string

  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selectedCards, setSelectedCards] = useState<Card[]>([])
  const [events, setEvents] = useState<GameEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [joined, setJoined] = useState(false)

  // We store team/seat choice before game starts
  const [myTeam, setMyTeam] = useState<'A' | 'B'>('A')
  const [mySeatIndex, setMySeatIndex] = useState(0)
  const isMobile = useIsMobile()

  // Redirect if not logged in
  useEffect(() => {
    if (!token || !user) {
      router.replace('/login')
    }
  }, [token, user, router])

  // Connect and join
  useEffect(() => {
    if (!user || !token) return

    const socket = getSocket()

    socket.on('connect', () => {
      setConnected(true)
      // Re-join on reconnect
      socket.emit('join-room', {
        roomId,
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        team: myTeam,
        seatIndex: mySeatIndex,
      })
      setJoined(true)
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('game-state', (state: GameState) => {
      setGameState(prev => {
        // Show toast when trick just completed (cards revealed)
        if (prev && state.currentTrick?.winnerId && !prev.currentTrick?.winnerId) {
          const pts = state.currentTrick.plays.flatMap(p => p.cards).reduce((s: number, c: Card) => s + (c.points ?? 0), 0)
          if (pts > 0) toast.success(`+${pts} 分！`, { duration: 1200 })
        }
        return state
      })
      setSelectedCards([])
    })

    socket.on('game-event', (event: GameEvent) => {
      setEvents(prev => [...prev, event])
    })

    // If already connected, emit join
    if (socket.connected && !joined) {
      socket.emit('join-room', {
        roomId,
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        team: myTeam,
        seatIndex: mySeatIndex,
      })
      setJoined(true)
      setConnected(true)
    }

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('game-state')
      socket.off('game-event')
    }
  }, [user, token, roomId, myTeam, mySeatIndex, joined])

  // Card selection toggle
  const toggleCard = useCallback((card: Card) => {
    setSelectedCards(prev => {
      const isSelected = prev.some(c => c.id === card.id)
      if (isSelected) return prev.filter(c => c.id !== card.id)
      return [...prev, card]
    })
  }, [])

  // Socket actions
  const socket = getSocket()
  const handleChangeTeam = (team: 'A' | 'B') => socket.emit('change-team', { team })

  const handleStartGame = () => socket.emit('start-game')

  const handleDeclareTrump = () => {
    if (selectedCards.length === 0) return
    socket.emit('declare-trump', { cards: selectedCards })
    setSelectedCards([])
  }

  const handleFinishDeclaring = () => socket.emit('finish-declaring')

  const handleExchangeKitty = () => {
    if (selectedCards.length !== 8) {
      toast.error('请选择恰好 8 张牌扣入底牌')
      return
    }
    socket.emit('exchange-kitty', { newKitty: selectedCards })
    setSelectedCards([])
  }

  const handlePlayCards = () => {
    if (selectedCards.length === 0) {
      toast.error('请先选择要出的牌')
      return
    }
    const myPlayer = gameState?.players.find(p => p.userId === user?.id)
    const hand = (myPlayer?.hand ?? []).filter((c): c is Card => !('hidden' in c))
    const trick = gameState?.currentTrick
    const isLeading = !trick || trick.plays.length === 0
    const led = isLeading ? selectedCards : (trick?.plays[0]?.cards ?? [])

    if (!isLeading && gameState?.trump) {
      if (selectedCards.length !== led.length) {
        toast.error(`需要出 ${led.length} 张牌，你选了 ${selectedCards.length} 张`)
        return
      }
      if (!isValidPlay(hand, selectedCards, led, gameState.trump, false)) {
        const ledSuit = getSuit(led[0], gameState.trump)
        const hasSuit = hand.some(c => getSuit(c, gameState.trump) === ledSuit)
        if (hasSuit) {
          toast.error(`必须跟${ledSuit === 'TRUMP' ? '主牌' : ledSuit}花色`)
        } else {
          toast.error('出牌不合规则，请重新选牌')
        }
        return
      }
    }

    socket.emit('play-cards', { cards: selectedCards })
    setSelectedCards([])
  }

  const handleNextRound = () => socket.emit('next-round')

  // ── Layout ──────────────────────────────────────────────────────────────────

  if (!user) return null

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-emerald-500" />
          <p className="text-zinc-400 text-sm">连接中...</p>
        </div>
      </div>
    )
  }

  const myPlayer = gameState.players.find(p => p.userId === user.id)
  const myHand = (myPlayer?.hand.filter(c => !('hidden' in c)) ?? []) as Card[]
  const sortedHand = gameState.trump
    ? sortHand(myHand, gameState.trump)
    : myHand

  // Build seat layout relative to me
  // seats sorted by seatIndex
  const allPlayers = [...gameState.players].sort((a, b) => a.seatIndex - b.seatIndex)
  const myIdx = allPlayers.findIndex(p => p.userId === user.id)

  // Positions: bottom=me, top=across, left=left, right=right
  // For 4p: indices 0,1,2,3 → me, right, across, left
  function getRelativePlayer(offset: number): PlayerState | undefined {
    if (myIdx < 0) return undefined
    const len = allPlayers.length
    return allPlayers[(myIdx + offset + len) % len]
  }

  const topPlayer    = getRelativePlayer(2)  // 对家 (across)
  const leftPlayer   = getRelativePlayer(allPlayers.length === 5 ? 4 : 3)  // 左家
  const rightPlayer  = getRelativePlayer(1)  // 右家
  const topLeftPlayer  = allPlayers.length === 5 ? getRelativePlayer(3) : undefined
  const topRightPlayer = allPlayers.length === 5 ? getRelativePlayer(2) : undefined

  const currentTrick = gameState.currentTrick

  // Compute played cards per position for PlayerSlot
  const myPlayedCards      = currentTrick?.plays.find(p => p.playerId === user.id)?.cards ?? []
  const topPlayedCards     = currentTrick?.plays.find(p => p.playerId === topPlayer?.userId)?.cards ?? []
  const leftPlayedCards    = currentTrick?.plays.find(p => p.playerId === leftPlayer?.userId)?.cards ?? []
  const rightPlayedCards   = currentTrick?.plays.find(p => p.playerId === rightPlayer?.userId)?.cards ?? []

  // ── Waiting Room (Lobby) ────────────────────────────────────────────────
  if (gameState.phase === 'waiting') {
    const teamA = gameState.players.filter(p => p.team === 'A')
    const teamB = gameState.players.filter(p => p.team === 'B')
    const myPlayer2 = gameState.players.find(p => p.userId === user.id)
    const total = gameState.players.length
    const aiNeeded = Math.max(0, 4 - total)
    const isCreator = gameState.players[0]?.userId === user.id

    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 bg-zinc-900/90 border-b border-white/5">
          <div className="flex items-center gap-2">
            <button onClick={() => router.push('/games')} className="text-zinc-500 hover:text-white text-sm">← 返回</button>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-400 text-xs font-mono">#{roomId.slice(0, 8)}</span>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`); toast.success('邀请链接已复制！') }}
            className="text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 px-3 py-1 rounded ring-1 ring-emerald-500/30 transition-colors"
          >
            📋 复制邀请链接
          </button>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="text-center">
            <h2 className="text-white text-xl font-bold">等待玩家加入</h2>
            <p className="text-zinc-500 text-sm mt-1">
              {aiNeeded > 0 ? `🤖 将自动补充 ${aiNeeded} 个AI玩家` : '人数已满，可以开始'}
            </p>
          </div>

          {/* Teams */}
          <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
            {/* Team A */}
            <div className="bg-blue-950/30 ring-1 ring-blue-800/40 rounded-xl p-4">
              <div className="text-blue-400 font-bold text-sm mb-3">A 队 ({teamA.length}人)</div>
              <div className="flex flex-col gap-2 min-h-[80px]">
                {teamA.map(p => (
                  <div key={p.userId} className="flex items-center gap-2">
                    <span className="text-lg">{p.avatar}</span>
                    <span className="text-zinc-200 text-sm">{p.username}</span>
                    {p.userId === user.id && <span className="text-xs text-blue-400 ml-auto">（你）</span>}
                  </div>
                ))}
                {teamA.length < 2 && <p className="text-zinc-600 text-xs">🤖 AI补位</p>}
              </div>
              {myPlayer2?.team !== 'A' && (
                <button
                  onClick={() => handleChangeTeam('A')}
                  className="mt-3 w-full text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 py-1.5 rounded ring-1 ring-blue-500/30 transition-colors"
                >
                  加入 A 队
                </button>
              )}
            </div>

            {/* Team B */}
            <div className="bg-red-950/30 ring-1 ring-red-800/40 rounded-xl p-4">
              <div className="text-red-400 font-bold text-sm mb-3">B 队 ({teamB.length}人)</div>
              <div className="flex flex-col gap-2 min-h-[80px]">
                {teamB.map(p => (
                  <div key={p.userId} className="flex items-center gap-2">
                    <span className="text-lg">{p.avatar}</span>
                    <span className="text-zinc-200 text-sm">{p.username}</span>
                    {p.userId === user.id && <span className="text-xs text-red-400 ml-auto">（你）</span>}
                  </div>
                ))}
                {teamB.length < 2 && <p className="text-zinc-600 text-xs">🤖 AI补位</p>}
              </div>
              {myPlayer2?.team !== 'B' && (
                <button
                  onClick={() => handleChangeTeam('B')}
                  className="mt-3 w-full text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 py-1.5 rounded ring-1 ring-red-500/30 transition-colors"
                >
                  加入 B 队
                </button>
              )}
            </div>
          </div>

          {/* Start button */}
          <div className="flex flex-col items-center gap-2">
            {isCreator ? (
              <button
                onClick={handleStartGame}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-10 py-3 rounded-xl text-base transition-colors"
              >
                {aiNeeded > 0 ? `🃏 开始游戏（+${aiNeeded}个AI）` : '🃏 开始游戏'}
              </button>
            ) : (
              <div className="text-zinc-400 text-sm">等待房主开始游戏...</div>
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 bg-zinc-900/90 border-b border-white/5 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/games')}
            className="text-zinc-500 hover:text-white transition-colors text-sm"
          >
            ← 返回
          </button>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-400 text-xs font-mono">#{roomId.slice(0, 8)}</span>
          <button
            onClick={() => {
              const url = `${window.location.origin}/room/${roomId}`
              navigator.clipboard.writeText(url)
              toast.success('邀请链接已复制！发给朋友即可加入')
            }}
            className="text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 px-2 py-0.5 rounded ring-1 ring-emerald-500/30 transition-colors"
          >
            📋 邀请
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Trump badge */}
          <div className="bg-amber-500/15 text-amber-400 text-xs font-bold px-2 py-0.5 rounded ring-1 ring-amber-500/25">
            主：{gameState.trump.suit
              ? gameState.trump.suit === 'joker'
                ? `${gameState.trump.level} 无主`
                : `${gameState.trump.level}${gameState.trump.suit}`
              : `${gameState.trump.level} 待叫`}
          </div>
          {/* Connection */}
          <div className={`flex items-center gap-1 text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </div>
        </div>
      </header>

      {/* ── Card table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 p-2 gap-2">

        {/* TOP SLOT */}
        <div className="flex justify-center shrink-0">
          {allPlayers.length === 5 ? (
            <div className="flex gap-3">
              <PlayerSlot
                player={topLeftPlayer !== myPlayer ? topLeftPlayer : undefined}
                position="top"
                isLandlord={gameState.landlordPlayerId === topLeftPlayer?.userId}
                isCurrentTurn={gameState.currentTurnPlayerId === topLeftPlayer?.userId}
                playedCards={currentTrick?.plays.find(p => p.playerId === topLeftPlayer?.userId)?.cards ?? []}
                label="等待玩家..."
              />
              <PlayerSlot
                player={topRightPlayer !== myPlayer ? topRightPlayer : undefined}
                position="top"
                isLandlord={gameState.landlordPlayerId === topRightPlayer?.userId}
                isCurrentTurn={gameState.currentTurnPlayerId === topRightPlayer?.userId}
                playedCards={currentTrick?.plays.find(p => p.playerId === topRightPlayer?.userId)?.cards ?? []}
                label="等待玩家..."
              />
            </div>
          ) : (
            <PlayerSlot
              player={topPlayer !== myPlayer ? topPlayer : undefined}
              position="top"
              isLandlord={gameState.landlordPlayerId === topPlayer?.userId}
              isCurrentTurn={gameState.currentTurnPlayerId === topPlayer?.userId}
              playedCards={topPlayedCards}
              label="等待对家..."
            />
          )}
        </div>

        {/* MIDDLE ROW: left | felt table | right */}
        <div className="flex-1 flex items-stretch gap-2 min-h-0">

          {/* LEFT SLOT */}
          <div className="flex items-center shrink-0">
            <PlayerSlot
              player={leftPlayer !== myPlayer ? leftPlayer : undefined}
              position="left"
              isLandlord={gameState.landlordPlayerId === leftPlayer?.userId}
              isCurrentTurn={gameState.currentTurnPlayerId === leftPlayer?.userId}
              playedCards={leftPlayedCards}
              label="等待左家..."
            />
          </div>

          {/* CENTER FELT TABLE */}
          <div className="flex-1 bg-emerald-950/40 rounded-2xl ring-1 ring-emerald-800/30 flex flex-col items-center justify-center gap-3 p-3 min-h-0 overflow-hidden">

            {/* Status message */}
            <div className="bg-zinc-900/70 ring-1 ring-white/8 rounded-xl px-4 py-2 text-center w-full max-w-xs">
              <p className="text-zinc-200 text-sm font-medium leading-snug">{gameState.message}</p>
            </div>

            {/* Game info strip */}
            <div className="flex items-center gap-3 text-xs flex-wrap justify-center">
              <span className="text-amber-400 font-bold">
                {gameState.trump.suit
                  ? gameState.trump.suit === 'joker'
                    ? `${gameState.trump.level} 无主`
                    : `${gameState.trump.level}${gameState.trump.suit}`
                  : `${gameState.trump.level} 待叫`}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-blue-400 font-semibold">A:{gameState.currentLevel.A}</span>
              <span className="text-zinc-600">vs</span>
              <span className="text-red-400 font-semibold">B:{gameState.currentLevel.B}</span>
              <span className="text-zinc-600">·</span>
              <PhaseLabel phase={gameState.phase} />
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500">第{gameState.roundNumber}局</span>
            </div>

            {/* Trick winner flash — visible during the 1.5s reveal window */}
            {currentTrick?.winnerId && (() => {
              const winnerPlay = currentTrick.plays.find(p => p.playerId === currentTrick.winnerId)
              const winnerPlayer = gameState.players.find(p => p.userId === currentTrick.winnerId)
              const isAtk = winnerPlayer?.team === gameState.currentAttacker
              const roleLabel = isAtk ? '庄家' : '闲家'
              if (!winnerPlay || winnerPlay.cards.length === 0) return null
              return (
                <div className="flex flex-col items-center gap-2 animate-in zoom-in-90 fade-in duration-300">
                  <div className="text-xs font-bold px-3 py-1 rounded-full ring-1"
                    style={isAtk
                      ? { color: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.12)', boxShadow: '0 0 12px rgba(251,191,36,0.25)', border: '1px solid rgba(251,191,36,0.3)' }
                      : { color: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', boxShadow: '0 0 12px rgba(52,211,153,0.25)', border: '1px solid rgba(52,211,153,0.3)' }
                    }
                  >
                    {winnerPlayer?.username}（{roleLabel}）赢！
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-center">
                    {winnerPlay.cards.map(c => (
                      <CardComponent
                        key={c.id}
                        card={c}
                        size="lg"
                        isTrumpCard={gameState.trump ? isTrump(c, gameState.trump) : false}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Score board — always visible during play */}
            {(gameState.phase === 'playing' || gameState.phase === 'scoring') && (() => {
              const atk = gameState.currentAttacker
              const def = atk === 'A' ? 'B' : 'A'
              const defPts = gameState.collectedPoints[def]
              const atkPts = gameState.collectedPoints[atk]
              const pct = Math.min(100, Math.round(defPts / 80 * 100))
              return (
                <div className="w-full max-w-xs bg-zinc-900/60 rounded-xl px-4 py-2.5 flex flex-col gap-1.5 ring-1 ring-white/8">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-400 font-bold">庄({atk}队) <span className="text-amber-300">{atkPts}分</span></span>
                    <span className="text-zinc-500 text-[10px]">闲家需80分</span>
                    <span className="text-emerald-400 font-bold">闲({def}队) <span className="text-emerald-300">{defPts}分</span></span>
                  </div>
                  <div className="w-full bg-zinc-700 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: defPts >= 80 ? '#34d399' : defPts >= 60 ? '#fbbf24' : '#64748b'
                      }}
                    />
                  </div>
                </div>
              )
            })()}
          </div>

          {/* RIGHT SLOT */}
          <div className="flex items-center shrink-0">
            <PlayerSlot
              player={rightPlayer !== myPlayer ? rightPlayer : undefined}
              position="right"
              isLandlord={gameState.landlordPlayerId === rightPlayer?.userId}
              isCurrentTurn={gameState.currentTurnPlayerId === rightPlayer?.userId}
              playedCards={rightPlayedCards}
              label="等待右家..."
            />
          </div>
        </div>

        {/* MY PLAYED CARDS — shown between felt table and my hand */}
        <div className="shrink-0 flex flex-col items-center gap-1 min-h-[4rem]">
          {myPlayedCards.length > 0 ? (
            <div className="flex gap-1 flex-wrap justify-center animate-in fade-in zoom-in-95 duration-200">
              {myPlayedCards.map(c => (
                <CardComponent key={c.id} card={c} size="md" />
              ))}
            </div>
          ) : (
            <div className="w-40 h-14 rounded-xl border-2 border-dashed border-zinc-800/60 flex items-center justify-center">
              <span className="text-zinc-700 text-xs">我的出牌区</span>
            </div>
          )}
        </div>
      </div>

      {/* ── My hand ─────────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900/95 border-t border-white/5 shrink-0">

        {/* My info bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="text-xl">{user.avatar}</span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-semibold ${myPlayer?.team === 'A' ? 'text-blue-300' : 'text-red-300'}`}>
                  {user.username}
                </span>
                {gameState.landlordPlayerId === user.id && (
                  <span className="bg-amber-500/20 text-amber-400 text-xs font-semibold px-1.5 py-0.5 rounded ring-1 ring-amber-500/30 flex items-center gap-0.5">
                    <Crown className="w-3 h-3" />庄
                  </span>
                )}
                {gameState.currentTurnPlayerId === user.id && (
                  <span className="text-emerald-400 text-xs font-bold animate-pulse">轮到你了!</span>
                )}
              </div>
              <span className={`text-xs font-bold ${myPlayer?.team === 'A' ? 'text-blue-500' : 'text-red-500'}`}>
                {myPlayer?.team ?? '?'}队
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedCards.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedCards([])}
                className="text-zinc-400 hover:text-white text-xs h-7 px-2"
              >
                取消选牌 ({selectedCards.length})
              </Button>
            )}
            <span className="bg-zinc-800 text-zinc-400 text-xs font-bold px-2 py-0.5 rounded-full ring-1 ring-zinc-700">
              {myHand.length}张
            </span>
          </div>
        </div>

        {/* Hand cards — centered when few cards, scrollable when many */}
        <div className="px-2 pt-3 pb-1 overflow-x-auto">
          <div className={`flex gap-1 px-1 ${sortedHand.length <= 8 ? 'justify-center' : 'min-w-max'}`}>
            {sortedHand.map((card) => {
              const isSelected = selectedCards.some(c => c.id === card.id)
              const isTrumpCard = gameState.trump ? isTrump(card, gameState.trump) : false
              const canInteract = gameState.phase !== 'finished' && gameState.phase !== 'waiting'

              return (
                <CardComponent
                  key={card.id}
                  card={card}
                  selected={isSelected}
                  onClick={() => canInteract && toggleCard(card)}
                  isTrumpCard={isTrumpCard}
                  size={isMobile ? 'sm' : 'md'}
                  disabled={!canInteract}
                />
              )
            })}
            {myHand.length === 0 && gameState.phase === 'playing' && (
              <p className="text-zinc-600 text-sm self-center px-4">手牌已出完</p>
            )}
          </div>
        </div>

        {/* Action panel */}
        <div className="px-4 py-2 border-t border-white/5 bg-zinc-900/60 flex flex-col items-center gap-2">
          <ActionPanel
            state={gameState}
            myUserId={user.id}
            selectedCards={selectedCards}
            onDeclareTrump={handleDeclareTrump}
            onFinishDeclaring={handleFinishDeclaring}
            onExchangeKitty={handleExchangeKitty}
            onPlayCards={handlePlayCards}
            onStartGame={handleStartGame}
            onNextRound={handleNextRound}
          />
        </div>

        {/* Event log */}
        <div className="border-t border-white/5 bg-zinc-950/60">
          <EventLog events={events} />
        </div>
      </div>
    </div>
  )
}
