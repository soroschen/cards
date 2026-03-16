import {
  Card,
  Suit,
  Value,
  TrumpInfo,
  createDeck,
  shuffle,
  dealCards,
  isTrump,
  getSuit,
  getTrickWinner,
  countPoints,
  isValidPlay,
} from './cards'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'waiting'
  | 'dealing'
  | 'declaring'
  | 'exchanging'
  | 'playing'
  | 'scoring'
  | 'finished'

export interface PlayerState {
  userId: string
  username: string
  avatar: string
  team: 'A' | 'B'
  hand: Card[]
  connected: boolean
  seatIndex: number
}

export interface TrumpDeclaration {
  playerId: string
  cards: Card[]       // the cards used (1 or 2 level cards)
  suit: Suit
  strength: number    // 1=single, 2=pair, 3=joker pair
}

export interface Trick {
  leadPlayerId: string
  plays: { playerId: string; cards: Card[] }[]
  winnerId?: string
}

export interface GameState {
  id: string
  phase: GamePhase
  players: PlayerState[]
  currentLevel: { A: Value; B: Value }
  currentAttacker: 'A' | 'B'   // team that is 庄家 (attacker/landlord side)
  trump: TrumpInfo
  kitty: Card[]
  currentTrick: Trick | null
  completedTricks: Trick[]
  collectedPoints: { A: number; B: number }
  currentTurnPlayerId: string | null
  declarationWindow: boolean      // true while declaring phase is open
  currentDeclaration: TrumpDeclaration | null
  landlordPlayerId: string | null // who is 庄
  roundNumber: number
  message: string
}

// ─── Level ordering ───────────────────────────────────────────────────────────

const LEVEL_ORDER: Value[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']

function levelIndex(v: Value): number {
  return LEVEL_ORDER.indexOf(v)
}

function advanceLevel(current: Value, steps: number): Value {
  const idx = levelIndex(current)
  const next = Math.min(idx + steps, LEVEL_ORDER.length - 1)
  return LEVEL_ORDER[next]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPlayer(state: GameState, userId: string): PlayerState | undefined {
  return state.players.find((p) => p.userId === userId)
}

function nextPlayerAfter(state: GameState, playerId: string): string {
  // Turn order follows seatIndex
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)
  const idx = sorted.findIndex((p) => p.userId === playerId)
  return sorted[(idx + 1) % sorted.length].userId
}

// ─── State creation ───────────────────────────────────────────────────────────

export function createGameState(
  gameId: string,
  players: {
    userId: string
    username: string
    avatar: string
    team: 'A' | 'B'
    seatIndex: number
  }[],
): GameState {
  return {
    id: gameId,
    phase: 'waiting',
    players: players.map((p) => ({
      ...p,
      hand: [],
      connected: true,
    })),
    currentLevel: { A: '2', B: '2' },
    currentAttacker: 'A',
    trump: { level: '2', suit: null },
    kitty: [],
    currentTrick: null,
    completedTricks: [],
    collectedPoints: { A: 0, B: 0 },
    currentTurnPlayerId: null,
    declarationWindow: false,
    currentDeclaration: null,
    landlordPlayerId: null,
    roundNumber: 1,
    message: '等待游戏开始',
  }
}

// ─── Deal ─────────────────────────────────────────────────────────────────────

export function startDealing(state: GameState): GameState {
  const numPlayers = state.players.length as 4 | 5
  const deck = shuffle(createDeck())
  const { hands, kitty } = dealCards(deck, numPlayers)
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)

  // Determine attacker team's level card to use as trump level
  const attackerLevel = state.currentLevel[state.currentAttacker]

  const newPlayers = state.players.map((p) => {
    const sortedIdx = sorted.findIndex((s) => s.userId === p.userId)
    return { ...p, hand: hands[sortedIdx] }
  })

  // Default landlord: attacker team, first seat
  const attackerPlayers = sorted.filter((p) => p.team === state.currentAttacker)
  const defaultLandlord = attackerPlayers[0]?.userId ?? sorted[0].userId

  return {
    ...state,
    phase: 'declaring',
    players: newPlayers,
    kitty,
    trump: { level: attackerLevel, suit: null },
    currentDeclaration: null,
    landlordPlayerId: defaultLandlord,
    declarationWindow: true,
    currentTurnPlayerId: null,
    completedTricks: [],
    collectedPoints: { A: 0, B: 0 },
    currentTrick: null,
    message: '请叫主（出示级牌）',
  }
}

// ─── Trump declaration ────────────────────────────────────────────────────────

function declarationStrength(cards: Card[], trump: TrumpInfo): number {
  if (cards.length === 2 && cards[0].value === 'big' && cards[1].value === 'big')
    return 3 // big joker pair
  if (
    cards.length === 2 &&
    cards[0].value === 'small' &&
    cards[1].value === 'small'
  )
    return 3 // small joker pair (also very strong)
  if (
    cards.length === 2 &&
    cards[0].value === trump.level &&
    cards[1].value === trump.level
  )
    return 2 // pair
  if (cards.length === 1 && cards[0].value === trump.level) return 1 // single
  return 0
}

export function declareTrump(
  state: GameState,
  playerId: string,
  cards: Card[],
): GameState {
  if (state.phase !== 'declaring') return state
  if (!state.declarationWindow) return state

  const player = getPlayer(state, playerId)
  if (!player) return state

  // Verify the player has all these cards in hand
  const handIds = new Set(player.hand.map((c) => c.id))
  if (!cards.every((c) => handIds.has(c.id))) return state

  // Determine declared suit
  let declaredSuit: Suit
  if (cards[0].value === 'big' || cards[0].value === 'small') {
    // Joker declaration — no specific suit, but counts as a trump declaration
    // Convention: joker pair means no-trump-suit (joker only trump)
    declaredSuit = 'joker'
  } else {
    declaredSuit = cards[0].suit as Suit
  }

  const newTrump: TrumpInfo = { level: state.trump.level, suit: declaredSuit }
  const strength = declarationStrength(cards, newTrump)

  if (strength === 0) return state // invalid

  const current = state.currentDeclaration
  // Can only override with strictly higher strength, or same strength by attacker team
  if (current) {
    if (strength < current.strength) return state
    if (
      strength === current.strength &&
      player.team !== state.currentAttacker
    )
      return state
  }

  const declaration: TrumpDeclaration = {
    playerId,
    cards,
    suit: declaredSuit,
    strength,
  }

  return {
    ...state,
    trump: newTrump,
    currentDeclaration: declaration,
    landlordPlayerId: playerId,
    message: `${player.username} 叫主：${declaredSuit === 'joker' ? '无主（大小王）' : declaredSuit}`,
  }
}

// ─── Finish declaring → exchanging ────────────────────────────────────────────

export function finishDeclaring(state: GameState): GameState {
  if (state.phase !== 'declaring') return state

  const landlord = getPlayer(state, state.landlordPlayerId!)
  if (!landlord) return state

  // Give kitty to the landlord
  const newPlayers = state.players.map((p) => {
    if (p.userId === state.landlordPlayerId) {
      return { ...p, hand: [...p.hand, ...state.kitty] }
    }
    return p
  })

  return {
    ...state,
    phase: 'exchanging',
    players: newPlayers,
    declarationWindow: false,
    currentTurnPlayerId: state.landlordPlayerId,
    message: `${landlord.username} 请换底牌（选择8张扣下）`,
  }
}

// ─── Kitty exchange ───────────────────────────────────────────────────────────

export function exchangeKitty(
  state: GameState,
  playerId: string,
  newKitty: Card[],
): GameState {
  if (state.phase !== 'exchanging') return state
  if (playerId !== state.landlordPlayerId) return state
  if (newKitty.length !== 8) return state

  const player = getPlayer(state, playerId)!
  const newKittyIds = new Set(newKitty.map((c) => c.id))
  const newHand = player.hand.filter((c) => !newKittyIds.has(c.id))

  if (newHand.length !== player.hand.length - 8) return state // must discard exactly 8

  const newPlayers = state.players.map((p) =>
    p.userId === playerId ? { ...p, hand: newHand } : p,
  )

  // Landlord leads first
  return {
    ...state,
    phase: 'playing',
    players: newPlayers,
    kitty: newKitty,
    currentTurnPlayerId: state.landlordPlayerId,
    currentTrick: {
      leadPlayerId: state.landlordPlayerId!,
      plays: [],
    },
    message: `${player.username} 换好底牌，开始出牌`,
  }
}

// ─── Play cards ───────────────────────────────────────────────────────────────

export function playCards(
  state: GameState,
  playerId: string,
  cards: Card[],
): GameState {
  if (state.phase !== 'playing') return state
  if (playerId !== state.currentTurnPlayerId) return state

  const player = getPlayer(state, playerId)!
  const trick = state.currentTrick!
  const isLeading = trick.plays.length === 0
  const led = isLeading ? cards : trick.plays[0]?.cards ?? []

  if (
    !isValidPlay(player.hand, cards, led, state.trump, isLeading)
  )
    return state

  // Remove played cards from hand
  const playedIds = new Set(cards.map((c) => c.id))
  const newHand = player.hand.filter((c) => !playedIds.has(c.id))
  const newPlayers = state.players.map((p) =>
    p.userId === playerId ? { ...p, hand: newHand } : p,
  )

  const newPlays = [...trick.plays, { playerId, cards }]
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)
  const trickComplete = newPlays.length === sorted.length

  if (!trickComplete) {
    // Move to next player
    return {
      ...state,
      players: newPlayers,
      currentTrick: { ...trick, plays: newPlays },
      currentTurnPlayerId: nextPlayerAfter(state, playerId),
      message: `${player.username} 出了 ${cards.length} 张牌`,
    }
  }

  // Trick is complete — determine winner
  const winnerId = getTrickWinner(newPlays, state.trump, trick.leadPlayerId)
  const winner = getPlayer(state, winnerId)!
  const completedTrick: Trick = {
    ...trick,
    plays: newPlays,
    winnerId,
  }

  // Collect points
  const trickCards = newPlays.flatMap((p) => p.cards)
  const trickPoints = countPoints(trickCards)
  const newPoints = {
    ...state.collectedPoints,
    [winner.team]:
      state.collectedPoints[winner.team] + trickPoints,
  }

  const completedTricks = [...state.completedTricks, completedTrick]

  // Check if round is over (hands exhausted)
  const anyCardsLeft = newPlayers.some((p) => p.hand.length > 0)

  if (!anyCardsLeft) {
    // Last trick: kitty points count double for winner
    const kittyPoints = countPoints(state.kitty) * 2
    newPoints[winner.team] += kittyPoints

    return {
      ...state,
      phase: 'scoring',
      players: newPlayers,
      currentTrick: null,
      completedTricks,
      collectedPoints: newPoints,
      currentTurnPlayerId: null,
      message: `${winner.username} 赢得最后一墩！底牌积分翻倍。`,
    }
  }

  // Start new trick
  return {
    ...state,
    players: newPlayers,
    currentTrick: {
      leadPlayerId: winnerId,
      plays: [],
    },
    completedTricks,
    collectedPoints: newPoints,
    currentTurnPlayerId: winnerId,
    message: `${winner.username} 赢得这墩，继续出牌`,
  }
}

// ─── Round result ─────────────────────────────────────────────────────────────

export function calculateRoundResult(state: GameState): {
  winnerTeam: 'A' | 'B'
  levelChange: number
  newLevels: { A: Value; B: Value }
  nextAttacker: 'A' | 'B'
  summary: string
} {
  const defenderTeam: 'A' | 'B' = state.currentAttacker === 'A' ? 'B' : 'A'
  const defenderPoints = state.collectedPoints[defenderTeam]

  // Scoring thresholds
  let levelChange: number
  let attackerWins: boolean

  if (defenderPoints >= 80) {
    attackerWins = false
    if (defenderPoints >= 200) levelChange = 3
    else if (defenderPoints >= 160) levelChange = 2
    else levelChange = 1
  } else {
    attackerWins = true
    if (defenderPoints === 0) levelChange = 3
    else if (defenderPoints < 40) levelChange = 2
    else levelChange = 1
  }

  const winnerTeam: 'A' | 'B' = attackerWins ? state.currentAttacker : defenderTeam

  const newLevels: { A: Value; B: Value } = {
    A: state.currentLevel.A,
    B: state.currentLevel.B,
  }
  newLevels[winnerTeam] = advanceLevel(state.currentLevel[winnerTeam], levelChange)

  // Next attacker: if defender wins, they become attacker (庄)
  const nextAttacker: 'A' | 'B' = attackerWins ? state.currentAttacker : defenderTeam

  const summary = attackerWins
    ? `庄家队(${state.currentAttacker}队)胜！守方仅得 ${defenderPoints} 分。${winnerTeam}队升 ${levelChange} 级。`
    : `非庄队(${defenderTeam}队)胜！收集了 ${defenderPoints} 分（≥80分）。${winnerTeam}队升 ${levelChange} 级，下局担庄。`

  return { winnerTeam, levelChange, newLevels, nextAttacker, summary }
}

// ─── Start next round (helper for server) ────────────────────────────────────

export function startNextRound(state: GameState): GameState {
  const result = calculateRoundResult(state)

  // Check for game over (any team at A+)
  const gameOver =
    result.newLevels.A === 'A' &&
    levelIndex(state.currentLevel.A) < levelIndex(result.newLevels.A)
      ? true
      : result.newLevels.B === 'A' &&
        levelIndex(state.currentLevel.B) < levelIndex(result.newLevels.B)
      ? true
      : result.winnerTeam === 'A'
      ? state.currentLevel.A === 'A'
      : state.currentLevel.B === 'A'

  if (gameOver) {
    return {
      ...state,
      phase: 'finished',
      currentLevel: result.newLevels,
      currentAttacker: result.nextAttacker,
      message: `游戏结束！${result.winnerTeam}队获胜！${result.summary}`,
    }
  }

  const baseState: GameState = {
    ...state,
    phase: 'dealing',
    currentLevel: result.newLevels,
    currentAttacker: result.nextAttacker,
    roundNumber: state.roundNumber + 1,
    message: result.summary,
  }

  return startDealing(baseState)
}
