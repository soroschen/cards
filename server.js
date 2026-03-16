// Custom Next.js server with Socket.io for 升级 (Sheng Ji) card game
'use strict'

const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

// ─── In-memory game state ─────────────────────────────────────────────────────

// Map<roomId, GameState>
const gameRooms = new Map()

// Map<socketId, { userId, username, avatar, roomId }>
const socketUsers = new Map()

// Map<userId, socketId>  – track current socket per user for reconnect
const userSockets = new Map()

// ─── Lazy-load game engine (ES module compiled to CJS via Next transpile) ─────
// We use dynamic require inside handlers because Next's TypeScript files get
// compiled to .next/server; however server.js runs before that transform during
// dev.  Instead we inline pure-JS versions of the critical functions here so
// the server has zero dependency on the TS build artefacts at startup.
//
// NOTE: The full game-engine logic is re-implemented below so server.js is
// self-contained and works in both dev and production without import issues.

// ─── Card utilities (mirror of src/lib/cards.ts) ─────────────────────────────

const SUITS = ['♠', '♥', '♦', '♣']
const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
const LEVEL_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']

function cardPoints(value) {
  if (value === '5') return 5
  if (value === '10' || value === 'K') return 10
  return 0
}

function createDeck() {
  const cards = []
  for (const deck of [1, 2]) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        cards.push({ id: `${deck}-${suit}-${value}`, suit, value, deck, points: cardPoints(value) })
      }
    }
    cards.push({ id: `${deck}-joker-small`, suit: 'joker', value: 'small', deck, points: 0 })
    cards.push({ id: `${deck}-joker-big`,   suit: 'joker', value: 'big',   deck, points: 0 })
  }
  return cards // 108 total
}

function shuffleCards(cards) {
  const arr = [...cards]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function dealCards(cards, numPlayers) {
  const kittySize = 8
  const handSize = numPlayers === 4 ? 25 : 20
  const kitty = cards.slice(0, kittySize)
  const rest  = cards.slice(kittySize)
  const hands = Array.from({ length: numPlayers }, (_, i) =>
    rest.slice(i * handSize, (i + 1) * handSize)
  )
  return { hands, kitty }
}

function isTrump(card, trump) {
  if (card.suit === 'joker') return true
  if (card.value === trump.level) return true
  if (trump.suit && trump.suit !== 'joker' && card.suit === trump.suit) return true
  return false
}

function getSuit(card, trump) {
  return isTrump(card, trump) ? 'TRUMP' : card.suit
}

function getCardRank(card, trump) {
  const vo = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'small':0,'big':0 }
  if (!isTrump(card, trump)) return vo[card.value]
  if (card.value === 'big')   return 200
  if (card.value === 'small') return 190
  if (card.value === trump.level && card.suit === trump.suit) return 180
  if (card.value === trump.level) return 170
  return 100 + vo[card.value]
}

function countPoints(cards) {
  return cards.reduce((s, c) => s + c.points, 0)
}

function getTrickWinner(plays, trump, leadPlayerId) {
  const leadPlay = plays.find(p => p.playerId === leadPlayerId)
  const leadSuit = getSuit(leadPlay.cards[0], trump)
  let winnerId = leadPlayerId
  let winnerRank = Math.max(...leadPlay.cards.map(c => getCardRank(c, trump)))
  let winnerIsTrump = isTrump(leadPlay.cards[0], trump)

  for (const play of plays) {
    if (play.playerId === leadPlayerId) continue
    const first = play.cards[0]
    const playSuit = getSuit(first, trump)
    const playRank = Math.max(...play.cards.map(c => getCardRank(c, trump)))
    const playIsTrump = isTrump(first, trump)

    if (playIsTrump && !winnerIsTrump) {
      winnerId = play.playerId; winnerRank = playRank; winnerIsTrump = true
    } else if (playIsTrump && winnerIsTrump && playRank > winnerRank) {
      winnerId = play.playerId; winnerRank = playRank
    } else if (!playIsTrump && !winnerIsTrump && playSuit === leadSuit && playRank > winnerRank) {
      winnerId = play.playerId; winnerRank = playRank
    }
  }
  return winnerId
}

function cardStructure(cards, trump) {
  if (cards.length === 1) return 'single'
  if (cards.length === 2) {
    if (cards[0].value === cards[1].value && getSuit(cards[0], trump) === getSuit(cards[1], trump))
      return 'pair'
    return 'mixed'
  }
  if (cards.length >= 4 && cards.length % 2 === 0) {
    const sorted = [...cards].sort((a, b) => getCardRank(a, trump) - getCardRank(b, trump))
    const suit = getSuit(sorted[0], trump)
    if (sorted.some(c => getSuit(c, trump) !== suit)) return 'mixed'
    for (let i = 0; i < sorted.length - 1; i += 2) {
      if (sorted[i].value !== sorted[i+1].value || getSuit(sorted[i], trump) !== getSuit(sorted[i+1], trump))
        return 'mixed'
    }
    const pairRanks = []
    for (let i = 0; i < sorted.length; i += 2) pairRanks.push(getCardRank(sorted[i], trump))
    for (let i = 1; i < pairRanks.length; i++) {
      if (pairRanks[i] - pairRanks[i - 1] !== 1) return 'mixed'
    }
    return 'tractor'
  }
  return 'mixed'
}

function countPairsInSuit(cards, suit, trump) {
  const suitCards = cards.filter(c => getSuit(c, trump) === suit)
  const vm = new Map()
  for (const c of suitCards) {
    const k = `${c.value}-${getSuit(c, trump)}`
    vm.set(k, (vm.get(k) ?? 0) + 1)
  }
  let pairs = 0
  for (const n of vm.values()) pairs += Math.floor(n / 2)
  return pairs
}

function isValidPlay(hand, played, led, trump, isLeading) {
  if (isLeading) return played.length > 0
  const handIds = new Set(hand.map(c => c.id))
  if (!played.every(c => handIds.has(c.id))) return false
  if (played.length !== led.length) return false
  const ledSuit = getSuit(led[0], trump)
  const inHand = hand.filter(c => getSuit(c, trump) === ledSuit).length
  if (inHand === 0) return true
  const playedInSuit = played.filter(c => getSuit(c, trump) === ledSuit).length
  if (playedInSuit < Math.min(inHand, led.length)) return false
  // Pair enforcement
  const ledStructure = cardStructure(led, trump)
  if (ledStructure === 'pair') {
    const handPairs = countPairsInSuit(hand, ledSuit, trump)
    if (handPairs >= 1) {
      const playedPairs = countPairsInSuit(played, ledSuit, trump)
      if (playedPairs < 1) return false
    }
  }
  if (ledStructure === 'tractor') {
    const handPairs = countPairsInSuit(hand, ledSuit, trump)
    const neededPairs = led.length / 2
    const playedPairs = countPairsInSuit(played, ledSuit, trump)
    if (playedPairs < Math.min(handPairs, neededPairs)) return false
  }
  return true
}

// ─── Game-engine helpers ──────────────────────────────────────────────────────

function advanceLevel(current, steps) {
  const idx = LEVEL_ORDER.indexOf(current)
  const next = Math.min(idx + steps, LEVEL_ORDER.length - 1)
  return LEVEL_ORDER[next]
}

function getPlayer(state, userId) {
  return state.players.find(p => p.userId === userId)
}

function nextPlayerAfter(state, playerId) {
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)
  const idx = sorted.findIndex(p => p.userId === playerId)
  return sorted[(idx + 1) % sorted.length].userId
}

function createGameState(gameId, players) {
  return {
    id: gameId,
    phase: 'waiting',
    players: players.map(p => ({ ...p, hand: [], connected: true })),
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
    fanZhu: false,
    message: '等待游戏开始',
  }
}

function startDealing(state) {
  const numPlayers = state.players.length
  const deck = shuffleCards(createDeck())
  const { hands, kitty } = dealCards(deck, numPlayers)
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)
  const attackerLevel = state.currentLevel[state.currentAttacker]

  const newPlayers = state.players.map(p => {
    const si = sorted.findIndex(s => s.userId === p.userId)
    return { ...p, hand: hands[si] }
  })

  const attackerPlayers = sorted.filter(p => p.team === state.currentAttacker)
  const defaultLandlord = (attackerPlayers[0] || sorted[0]).userId

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
    fanZhu: false,
    message: '请叫主（出示级牌）',
  }
}

function declarationStrength(cards, trump) {
  if (cards.length === 2 && cards[0].value === 'big'   && cards[1].value === 'big')   return 3
  if (cards.length === 2 && cards[0].value === 'small' && cards[1].value === 'small') return 3
  if (cards.length === 2 && cards[0].value === trump.level && cards[1].value === trump.level) return 2
  if (cards.length === 1 && cards[0].value === trump.level) return 1
  return 0
}

function declareTrump(state, playerId, cards) {
  if (state.phase !== 'declaring' || !state.declarationWindow) return state
  const player = getPlayer(state, playerId)
  if (!player) return state
  const handIds = new Set(player.hand.map(c => c.id))
  if (!cards.every(c => handIds.has(c.id))) return state

  let declaredSuit
  if (cards[0].value === 'big' || cards[0].value === 'small') {
    declaredSuit = 'joker'
  } else {
    declaredSuit = cards[0].suit
  }

  const newTrump = { level: state.trump.level, suit: declaredSuit }
  const strength = declarationStrength(cards, newTrump)
  if (strength === 0) return state

  const current = state.currentDeclaration
  if (current) {
    if (strength < current.strength) return state
    if (strength === current.strength) {
      // Allow 反主: defender can counter-declare in the SAME suit with same strength
      if (player.team === state.currentAttacker) return state  // attacker can't re-declare same
      if (declaredSuit !== current.suit) return state          // different suit same strength = no
      // Same suit same strength by defender = 反主, fall through to allow
    }
  }

  return {
    ...state,
    trump: newTrump,
    currentDeclaration: { playerId, cards, suit: declaredSuit, strength },
    landlordPlayerId: playerId,
    fanZhu: current ? player.team !== state.currentAttacker : state.fanZhu,
    message: `${player.username} ${current && player.team !== state.currentAttacker ? '反主！' : '叫主'}：${declaredSuit === 'joker' ? '无主（大小王）' : declaredSuit}`,
  }
}

function finishDeclaring(state) {
  if (state.phase !== 'declaring') return state
  const landlord = getPlayer(state, state.landlordPlayerId)
  if (!landlord) return state

  const newPlayers = state.players.map(p => {
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

function exchangeKitty(state, playerId, newKitty) {
  if (state.phase !== 'exchanging') return state
  if (playerId !== state.landlordPlayerId) return state
  if (newKitty.length !== 8) return state

  const player = getPlayer(state, playerId)
  const newKittyIds = new Set(newKitty.map(c => c.id))
  const newHand = player.hand.filter(c => !newKittyIds.has(c.id))
  if (newHand.length !== player.hand.length - 8) return state

  const newPlayers = state.players.map(p =>
    p.userId === playerId ? { ...p, hand: newHand } : p
  )

  return {
    ...state,
    phase: 'playing',
    players: newPlayers,
    kitty: newKitty,
    currentTurnPlayerId: state.landlordPlayerId,
    currentTrick: { leadPlayerId: state.landlordPlayerId, plays: [] },
    message: `${player.username} 换好底牌，开始出牌`,
  }
}

function playCardsEngine(state, playerId, cards) {
  if (state.phase !== 'playing') return state
  if (playerId !== state.currentTurnPlayerId) return state

  const player = getPlayer(state, playerId)
  const trick = state.currentTrick
  const isLeading = trick.plays.length === 0
  const led = isLeading ? cards : trick.plays[0]?.cards ?? []

  if (!isValidPlay(player.hand, cards, led, state.trump, isLeading)) return state

  const playedIds = new Set(cards.map(c => c.id))
  const newHand = player.hand.filter(c => !playedIds.has(c.id))
  const newPlayers = state.players.map(p =>
    p.userId === playerId ? { ...p, hand: newHand } : p
  )
  const newPlays = [...trick.plays, { playerId, cards }]
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)
  const trickComplete = newPlays.length === sorted.length

  if (!trickComplete) {
    return {
      ...state,
      players: newPlayers,
      currentTrick: { ...trick, plays: newPlays },
      currentTurnPlayerId: nextPlayerAfter(state, playerId),
      message: `${player.username} 出了 ${cards.length} 张牌`,
    }
  }

  const winnerId = getTrickWinner(newPlays, state.trump, trick.leadPlayerId)
  const winner = getPlayer({ ...state, players: newPlayers }, winnerId)
  const completedTrick = { ...trick, plays: newPlays, winnerId }
  const trickCards = newPlays.flatMap(p => p.cards)
  const trickPoints = countPoints(trickCards)
  const newPoints = {
    ...state.collectedPoints,
    [winner.team]: state.collectedPoints[winner.team] + trickPoints,
  }

  // 甩牌 bonus: if lead played pair/tractor and won, caught cards score double
  let shuaiPaiMsg = ''
  const ledStructure = cardStructure(led, state.trump)
  if ((ledStructure === 'pair' || ledStructure === 'tractor') && winnerId === trick.leadPlayerId) {
    const otherPlays = newPlays.filter(p => p.playerId !== trick.leadPlayerId)
    const caughtPoints = otherPlays
      .filter(p => cardStructure(p.cards, state.trump) !== ledStructure)
      .flatMap(p => p.cards)
      .reduce((s, c) => s + c.points, 0)
    if (caughtPoints > 0) {
      newPoints[winner.team] += caughtPoints // double count
      shuaiPaiMsg = `，甩牌+${caughtPoints}分`
    }
  }

  const completedTricks = [...state.completedTricks, completedTrick]
  const anyCardsLeft = newPlayers.some(p => p.hand.length > 0)

  const isAttackerWinner = winner.team === state.currentAttacker
  const roleLabel = isAttackerWinner ? '庄家' : '闲家'
  const pointsLabel = trickPoints > 0 ? `，${roleLabel}+${trickPoints}分` : ''
  // shuaiPaiMsg is computed above (empty string if no 甩牌 bonus)

  if (!anyCardsLeft) {
    const kittyPoints = countPoints(state.kitty) * 2
    newPoints[winner.team] += kittyPoints
    const kittyLabel = kittyPoints > 0 ? `，底牌翻倍+${kittyPoints}分` : ''
    return {
      ...state,
      phase: 'scoring',
      players: newPlayers,
      currentTrick: null,
      completedTricks,
      collectedPoints: newPoints,
      currentTurnPlayerId: null,
      message: `${winner.username}（${roleLabel}）赢最后一墩${shuaiPaiMsg}${kittyLabel}`,
    }
  }

  return {
    ...state,
    players: newPlayers,
    currentTrick: { leadPlayerId: winnerId, plays: [] },
    completedTricks,
    collectedPoints: newPoints,
    currentTurnPlayerId: winnerId,
    message: `${winner.username}（${roleLabel}）赢这墩${pointsLabel}${shuaiPaiMsg}`,
  }
}

function calculateRoundResult(state) {
  const defenderTeam = state.currentAttacker === 'A' ? 'B' : 'A'
  const defenderPoints = state.collectedPoints[defenderTeam]
  let levelChange, attackerWins

  if (defenderPoints >= 80) {
    attackerWins = false
    levelChange = defenderPoints >= 200 ? 3 : defenderPoints >= 160 ? 2 : 1
  } else {
    attackerWins = true
    levelChange = defenderPoints === 0 ? 3 : defenderPoints < 40 ? 2 : 1
  }

  // 反主 bonus: raises stakes by +1 level for whoever wins
  if (state.fanZhu) levelChange = Math.min(levelChange + 1, 3)

  const winnerTeam = attackerWins ? state.currentAttacker : defenderTeam
  const newLevels = { A: state.currentLevel.A, B: state.currentLevel.B }
  newLevels[winnerTeam] = advanceLevel(state.currentLevel[winnerTeam], levelChange)
  const nextAttacker = attackerWins ? state.currentAttacker : defenderTeam
  const summary = attackerWins
    ? `庄家队(${state.currentAttacker}队)胜！守方仅得 ${defenderPoints} 分。${winnerTeam}队升 ${levelChange} 级。`
    : `非庄队(${defenderTeam}队)胜！收集了 ${defenderPoints} 分（≥80分）。${winnerTeam}队升 ${levelChange} 级，下局担庄。`

  return { winnerTeam, levelChange, newLevels, nextAttacker, summary }
}

function startNextRound(state) {
  const result = calculateRoundResult(state)
  const isAtA_A = result.newLevels.A === 'A' && LEVEL_ORDER.indexOf(state.currentLevel.A) < LEVEL_ORDER.indexOf(result.newLevels.A)
  const isAtA_B = result.newLevels.B === 'A' && LEVEL_ORDER.indexOf(state.currentLevel.B) < LEVEL_ORDER.indexOf(result.newLevels.B)
  const alreadyWon = (result.winnerTeam === 'A' && state.currentLevel.A === 'A') || (result.winnerTeam === 'B' && state.currentLevel.B === 'A')
  const gameOver = isAtA_A || isAtA_B || alreadyWon

  if (gameOver) {
    return {
      ...state,
      phase: 'finished',
      currentLevel: result.newLevels,
      currentAttacker: result.nextAttacker,
      message: `游戏结束！${result.winnerTeam}队获胜！${result.summary}`,
    }
  }

  const baseState = {
    ...state,
    phase: 'dealing',
    currentLevel: result.newLevels,
    currentAttacker: result.nextAttacker,
    roundNumber: state.roundNumber + 1,
    message: result.summary,
  }
  return startDealing(baseState)
}

// ─── Personalized view ────────────────────────────────────────────────────────

/** Return a game state with only the requesting player's hand visible */
function personalizedState(state, myUserId) {
  return {
    ...state,
    players: state.players.map(p => {
      if (p.userId === myUserId) return p
      return { ...p, hand: p.hand.map(() => ({ id: 'hidden', hidden: true })) }
    }),
  }
}

// ─── Socket.io event helpers ──────────────────────────────────────────────────

function broadcastState(io, roomId, state) {
  const room = io.sockets.adapter.rooms.get(roomId)
  if (!room) return
  for (const socketId of room) {
    const meta = socketUsers.get(socketId)
    if (!meta) continue
    const view = personalizedState(state, meta.userId)
    io.to(socketId).emit('game-state', view)
  }
}

function broadcastEvent(io, roomId, message) {
  io.to(roomId).emit('game-event', { message, timestamp: Date.now() })
}

// ─── AI helpers ───────────────────────────────────────────────────────────────

function fillWithAI(players, targetCount) {
  const result = [...players]
  for (let i = result.length; i < targetCount; i++) {
    // Determine team: alternate A/B starting from A for first AI slot
    const countA = result.filter(p => p.team === 'A').length
    const countB = result.filter(p => p.team === 'B').length
    const team = countA <= countB ? 'A' : 'B'
    result.push({
      userId: `ai-${i}`,
      username: `AI玩家${i + 1}`,
      avatar: '🤖',
      team,
      seatIndex: i,
      hand: [],
      connected: true,
      isAI: true,
    })
  }
  return result
}

function aiChooseKitty(hand, trump) {
  const scored = hand.map(card => {
    let score = 0
    if (card.value === 'big' || card.value === 'small') score += 1000  // never discard jokers
    else if (card.value === trump.level) score += 900                   // never discard level cards
    else if (isTrump(card, trump)) score += 500 + getCardRank(card, trump) // keep trumps
    else {
      // Non-trump: prefer to discard; keep high cards and scoring cards
      score = getCardRank(card, trump) + card.points * 10
    }
    return { card, score }
  })
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, 8).map(s => s.card)
}

function aiLead(hand, trump, state, aiPlayer) {
  const nonTrump = hand.filter(c => !isTrump(c, trump))
  const trumpCards = hand.filter(c => isTrump(c, trump))

  // Group non-trump by suit
  const bySuit = {}
  for (const c of nonTrump) {
    if (!bySuit[c.suit]) bySuit[c.suit] = []
    bySuit[c.suit].push(c)
  }

  // Lead Ace of non-trump suit if available (can't lose)
  for (const suit of Object.keys(bySuit)) {
    const aces = bySuit[suit].filter(c => c.value === 'A')
    if (aces.length > 0) return [aces[0]]
  }

  // Lead lowest non-trump to avoid wasting trumps
  if (nonTrump.length > 0) {
    nonTrump.sort((a, b) => getCardRank(a, trump) - getCardRank(b, trump))
    return [nonTrump[0]]
  }

  // Only trumps left
  if (trumpCards.length > 0) {
    trumpCards.sort((a, b) => getCardRank(a, trump) - getCardRank(b, trump))
    return [trumpCards[0]]
  }

  return [hand[0]]
}

function aiFollow(hand, trump, state, aiPlayer, trick) {
  const led = trick.plays[0].cards
  const ledSuit = getSuit(led[0], trump)
  const numCards = led.length

  const inSuit = hand.filter(c => getSuit(c, trump) === ledSuit)

  // Determine who is currently winning
  const currentWinnerId = getTrickWinner(trick.plays, trump, trick.leadPlayerId)
  const winnerPlayer = state.players.find(p => p.userId === currentWinnerId)
  const partnerWinning = winnerPlayer && winnerPlayer.team === aiPlayer.team

  if (partnerWinning) {
    if (inSuit.length >= numCards) {
      // Must follow suit - play scoring cards to partner if possible, else lowest
      const sorted = [...inSuit].sort((a, b) => b.points - a.points || getCardRank(b, trump) - getCardRank(a, trump))
      return sorted.slice(0, numCards)
    }
    // Can't fully follow - play what we have + throw scoring non-trump to partner
    const partial = inSuit.slice()
    const remaining = numCards - partial.length
    const others = hand.filter(c => getSuit(c, trump) !== ledSuit)
    others.sort((a, b) => b.points - a.points)
    return [...partial, ...others.slice(0, remaining)]
  } else {
    if (inSuit.length >= numCards) {
      // Try to beat current winner
      const currentWinRank = Math.max(...trick.plays.map(p => Math.max(...p.cards.map(c => getCardRank(c, trump)))))
      const canBeat = inSuit.filter(c => getCardRank(c, trump) > currentWinRank)
      if (canBeat.length >= numCards) {
        canBeat.sort((a, b) => getCardRank(a, trump) - getCardRank(b, trump))
        return canBeat.slice(0, numCards)
      }
      // Can't beat - play lowest
      inSuit.sort((a, b) => getCardRank(a, trump) - getCardRank(b, trump))
      return inSuit.slice(0, numCards)
    }
    // Can't fully follow - play what we have + lowest others
    const partial = inSuit.slice()
    const remaining = numCards - partial.length
    const others = hand.filter(c => getSuit(c, trump) !== ledSuit)
    others.sort((a, b) => getCardRank(a, trump) - getCardRank(b, trump))
    return [...partial, ...others.slice(0, remaining)]
  }
}

function aiChooseCards(aiPlayer, state) {
  const hand = aiPlayer.hand
  const trump = state.trump
  const trick = state.currentTrick
  const isLeading = !trick || trick.plays.length === 0

  if (isLeading) {
    return aiLead(hand, trump, state, aiPlayer)
  } else {
    return aiFollow(hand, trump, state, aiPlayer, trick)
  }
}

function triggerAIMove(io, roomId) {
  const state = gameRooms.get(roomId)
  if (!state) return

  // Declaring phase: AI players consider declaring if they have level card pairs
  if (state.phase === 'declaring' && state.declarationWindow) {
    for (const player of state.players) {
      if (!player.isAI) continue
      const levelCards = player.hand.filter(c => c.value === state.trump.level && c.suit !== 'joker')
      if (levelCards.length >= 2) {
        const current = state.currentDeclaration
        if (!current || current.strength < 2) {
          setTimeout(() => {
            const s = gameRooms.get(roomId)
            if (!s || s.phase !== 'declaring') return
            const aiPlayer = s.players.find(p => p.userId === player.userId)
            if (!aiPlayer) return
            const cards = aiPlayer.hand.filter(c => c.value === s.trump.level && c.suit !== 'joker').slice(0, 2)
            if (cards.length < 2) return
            const newState = declareTrump(s, player.userId, cards)
            if (newState === s) return
            gameRooms.set(roomId, newState)
            broadcastEvent(io, roomId, `${player.username} 叫主 ${cards[0].suit}`)
            broadcastState(io, roomId, newState)
            triggerAIMove(io, roomId)
          }, 800 + Math.random() * 400)
        }
      }
    }
    // Auto-finish declaring after 3s if all players are AI and no one has started yet
    const allAI = state.players.every(p => p.isAI)
    if (allAI) {
      setTimeout(() => {
        const s = gameRooms.get(roomId)
        if (!s || s.phase !== 'declaring') return
        const ns = finishDeclaring(s)
        if (ns === s) return
        gameRooms.set(roomId, ns)
        broadcastEvent(io, roomId, ns.message)
        broadcastState(io, roomId, ns)
        triggerAIMove(io, roomId)
      }, 3000)
    }
    return
  }

  // Exchanging phase: AI landlord exchanges kitty
  if (state.phase === 'exchanging' && state.landlordPlayerId) {
    const landlord = state.players.find(p => p.userId === state.landlordPlayerId)
    if (landlord && landlord.isAI) {
      setTimeout(() => {
        const s = gameRooms.get(roomId)
        if (!s || s.phase !== 'exchanging') return
        const ai = s.players.find(p => p.userId === landlord.userId)
        if (!ai) return
        const kittyCards = aiChooseKitty(ai.hand, s.trump)
        const newState = exchangeKitty(s, ai.userId, kittyCards)
        if (newState === s) return
        gameRooms.set(roomId, newState)
        broadcastEvent(io, roomId, `${ai.username} 完成换底`)
        broadcastState(io, roomId, newState)
        triggerAIMove(io, roomId)
      }, 1000 + Math.random() * 500)
    }
    return
  }

  // Playing phase: AI takes their turn
  if (state.phase === 'playing' && state.currentTurnPlayerId) {
    const currentPlayer = state.players.find(p => p.userId === state.currentTurnPlayerId)
    if (currentPlayer && currentPlayer.isAI) {
      setTimeout(() => {
        const s = gameRooms.get(roomId)
        if (!s || s.phase !== 'playing') return
        if (s.currentTurnPlayerId !== currentPlayer.userId) return
        const ai = s.players.find(p => p.userId === currentPlayer.userId)
        if (!ai) return
        const cards = aiChooseCards(ai, s)
        if (!cards || cards.length === 0) return
        const newState = playCardsEngine(s, ai.userId, cards)
        if (newState === s) return

        const prevPlays = s.currentTrick?.plays ?? []
        const trickJustCompleted = prevPlays.length === s.players.length - 1
          && (newState.currentTrick?.plays.length === 0 || newState.phase === 'scoring')

        if (trickJustCompleted) {
          const allPlays = [...prevPlays, { playerId: ai.userId, cards }]
          const winnerId = newState.completedTricks[newState.completedTricks.length - 1]?.winnerId
          const winner = s.players.find(p => p.userId === winnerId)
          const trickPoints = allPlays.flatMap(p => p.cards).reduce((sum, c) => sum + c.points, 0)
          const isAttackerWinner = winner?.team === s.currentAttacker
          const roleLabel = isAttackerWinner ? '庄家' : '闲家'
          const pointsMsg = trickPoints > 0 ? `，${roleLabel}+${trickPoints}分` : ''
          const revealState = {
            ...newState,
            currentTrick: { leadPlayerId: s.currentTrick.leadPlayerId, plays: allPlays, winnerId },
            currentTurnPlayerId: null,
            message: `${winner?.username ?? '?'}（${roleLabel}）赢这墩${pointsMsg}`,
          }
          gameRooms.set(roomId, revealState)
          broadcastEvent(io, roomId, revealState.message)
          broadcastState(io, roomId, revealState)
          setTimeout(() => {
            const cur = gameRooms.get(roomId)
            if (!cur) return
            gameRooms.set(roomId, newState)
            broadcastState(io, roomId, newState)
            if (newState.phase === 'scoring') {
              broadcastEvent(io, roomId, newState.message)
              setTimeout(() => {
                const sc = gameRooms.get(roomId)
                if (!sc || sc.phase !== 'scoring') return
                const next = startNextRound(sc)
                gameRooms.set(roomId, next)
                broadcastEvent(io, roomId, next.message)
                broadcastState(io, roomId, next)
                triggerAIMove(io, roomId)
              }, 5000)
            } else {
              triggerAIMove(io, roomId)
            }
          }, 1500)
        } else {
          gameRooms.set(roomId, newState)
          broadcastEvent(io, roomId, newState.message)
          broadcastState(io, roomId, newState)
          triggerAIMove(io, roomId)
        }
      }, 800 + Math.random() * 600)
    }
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    path: '/api/socket',
    cors: { origin: '*' },
    // Allow larger payloads for card hands
    maxHttpBufferSize: 1e7,
  })

  io.on('connection', (socket) => {
    console.log('[socket] connected:', socket.id)

    // ── join-room ──────────────────────────────────────────────────────────
    // payload: { roomId, userId, username, avatar, team, seatIndex }
    socket.on('join-room', (payload) => {
      const { roomId, userId, username, avatar, team, seatIndex } = payload
      if (!roomId || !userId) return

      // Update tracking
      socketUsers.set(socket.id, { userId, username, avatar, roomId })

      // Handle reconnect: remove old socket mapping
      const oldSocketId = userSockets.get(userId)
      if (oldSocketId && oldSocketId !== socket.id) {
        socketUsers.delete(oldSocketId)
      }
      userSockets.set(userId, socket.id)

      socket.join(roomId)

      // Create or update game room
      if (!gameRooms.has(roomId)) {
        const players = [{ userId, username, avatar, team: team || 'A', seatIndex: seatIndex ?? 0 }]
        const state = createGameState(roomId, players)
        gameRooms.set(roomId, state)
        console.log(`[game] room ${roomId} created by ${username}`)
      } else {
        const state = gameRooms.get(roomId)
        const existing = state.players.find(p => p.userId === userId)
        if (!existing) {
          // New player joining
          const newPlayer = {
            userId, username, avatar,
            team: team || 'A',
            seatIndex: seatIndex ?? state.players.length,
            hand: [],
            connected: true,
          }
          state.players.push(newPlayer)
          gameRooms.set(roomId, state)
        } else {
          // Reconnect
          existing.connected = true
          gameRooms.set(roomId, state)
        }
      }

      const state = gameRooms.get(roomId)
      broadcastEvent(io, roomId, `${username} 加入了房间`)
      broadcastState(io, roomId, state)
    })

    // ── change-team ────────────────────────────────────────────────────────
    socket.on('change-team', ({ team }) => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state || state.phase !== 'waiting') return
      const player = state.players.find(p => p.userId === meta.userId)
      if (!player) return
      player.team = team
      gameRooms.set(meta.roomId, state)
      broadcastEvent(io, meta.roomId, `${meta.username} 加入了 ${team} 队`)
      broadcastState(io, meta.roomId, state)
    })

    // ── start-game ─────────────────────────────────────────────────────────
    socket.on('start-game', () => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state) return
      if (state.phase !== 'waiting') return

      // Fill remaining seats with AI players if fewer than 4 humans
      const humanCount = state.players.length
      if (humanCount < 4) {
        const filledPlayers = fillWithAI(state.players, 4)
        state.players = filledPlayers
        gameRooms.set(meta.roomId, state)
        const aiCount = 4 - humanCount
        broadcastEvent(io, meta.roomId, `已添加 ${aiCount} 个AI玩家，游戏开始！`)
      }

      const newState = startDealing(state)
      gameRooms.set(meta.roomId, newState)
      broadcastEvent(io, meta.roomId, '游戏开始！牌已发好，请叫主。')
      broadcastState(io, meta.roomId, newState)
      triggerAIMove(io, meta.roomId)
    })

    // ── declare-trump ──────────────────────────────────────────────────────
    // payload: { cards: Card[] }
    socket.on('declare-trump', (payload) => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state) return

      const newState = declareTrump(state, meta.userId, payload.cards)
      if (newState === state) return // no change / invalid

      gameRooms.set(meta.roomId, newState)
      broadcastEvent(io, meta.roomId, newState.message)
      broadcastState(io, meta.roomId, newState)
      triggerAIMove(io, meta.roomId)
    })

    // ── finish-declaring ───────────────────────────────────────────────────
    socket.on('finish-declaring', () => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state) return
      // Only landlord or any player after timeout can trigger this
      const newState = finishDeclaring(state)
      if (newState === state) return

      gameRooms.set(meta.roomId, newState)
      broadcastEvent(io, meta.roomId, newState.message)
      broadcastState(io, meta.roomId, newState)
      triggerAIMove(io, meta.roomId)
    })

    // ── exchange-kitty ─────────────────────────────────────────────────────
    // payload: { newKitty: Card[] }
    socket.on('exchange-kitty', (payload) => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state) return

      const newState = exchangeKitty(state, meta.userId, payload.newKitty)
      if (newState === state) return

      gameRooms.set(meta.roomId, newState)
      broadcastEvent(io, meta.roomId, newState.message)
      broadcastState(io, meta.roomId, newState)
      triggerAIMove(io, meta.roomId)
    })

    // ── play-cards ─────────────────────────────────────────────────────────
    // payload: { cards: Card[] }
    socket.on('play-cards', (payload) => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state) return

      const newState = playCardsEngine(state, meta.userId, payload.cards)
      if (newState === state) return

      // Detect if a trick just completed (all players played)
      const prevPlays = state.currentTrick?.plays ?? []
      const trickJustCompleted = prevPlays.length === state.players.length - 1
        && (newState.currentTrick?.plays.length === 0 || newState.phase === 'scoring')

      if (trickJustCompleted) {
        // Build a "reveal" state: show all cards + winner highlight for 1.5s
        const allPlays = [...prevPlays, { playerId: meta.userId, cards: payload.cards }]
        const winnerId = newState.completedTricks[newState.completedTricks.length - 1]?.winnerId
        const winner = state.players.find(p => p.userId === winnerId)
        const trickPoints = allPlays.flatMap(p => p.cards).reduce((s, c) => s + c.points, 0)
        const isAttackerWinner = winner?.team === state.currentAttacker
        const roleLabel = isAttackerWinner ? '庄家' : '闲家'
        const pointsMsg = trickPoints > 0 ? `，${roleLabel}+${trickPoints}分` : ''
        const revealState = {
          ...newState,
          currentTrick: { leadPlayerId: state.currentTrick.leadPlayerId, plays: allPlays, winnerId },
          currentTurnPlayerId: null,
          message: `${winner?.username ?? '?'}（${roleLabel}）赢这墩${pointsMsg}`,
        }
        gameRooms.set(meta.roomId, revealState)
        broadcastEvent(io, meta.roomId, revealState.message)
        broadcastState(io, meta.roomId, revealState)

        // After 1.5s, broadcast the real new state
        setTimeout(() => {
          const current = gameRooms.get(meta.roomId)
          if (!current) return
          gameRooms.set(meta.roomId, newState)
          broadcastState(io, meta.roomId, newState)

          if (newState.phase === 'scoring') {
            broadcastEvent(io, meta.roomId, newState.message)
            // Auto-advance after 5s
            setTimeout(() => {
              const s = gameRooms.get(meta.roomId)
              if (!s || s.phase !== 'scoring') return
              const next = startNextRound(s)
              gameRooms.set(meta.roomId, next)
              broadcastEvent(io, meta.roomId, next.message)
              broadcastState(io, meta.roomId, next)
              triggerAIMove(io, meta.roomId)
            }, 5000)
          } else {
            triggerAIMove(io, meta.roomId)
          }
        }, 1500)
        return
      }

      gameRooms.set(meta.roomId, newState)
      broadcastEvent(io, meta.roomId, newState.message)
      broadcastState(io, meta.roomId, newState)
      triggerAIMove(io, meta.roomId)
    })

    // ── next-round ─────────────────────────────────────────────────────────
    // Manual trigger for scoring -> dealing transition
    socket.on('next-round', () => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state || state.phase !== 'scoring') return

      const newState = startNextRound(state)
      gameRooms.set(meta.roomId, newState)
      broadcastEvent(io, meta.roomId, newState.message)
      broadcastState(io, meta.roomId, newState)
    })

    // ── get-state ──────────────────────────────────────────────────────────
    socket.on('get-state', () => {
      const meta = socketUsers.get(socket.id)
      if (!meta) return
      const state = gameRooms.get(meta.roomId)
      if (!state) return
      socket.emit('game-state', personalizedState(state, meta.userId))
    })

    // ── disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const meta = socketUsers.get(socket.id)
      if (meta) {
        const state = gameRooms.get(meta.roomId)
        if (state) {
          const player = state.players.find(p => p.userId === meta.userId)
          if (player) {
            player.connected = false
            broadcastEvent(io, meta.roomId, `${meta.username} 断线了`)
            broadcastState(io, meta.roomId, state)
          }
        }
        socketUsers.delete(socket.id)
        if (userSockets.get(meta.userId) === socket.id) {
          userSockets.delete(meta.userId)
        }
      }
      console.log('[socket] disconnected:', socket.id)
    })
  })

  const PORT = process.env.PORT || 3000
  httpServer.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`)
  })
})
