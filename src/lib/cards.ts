// ─── Types ────────────────────────────────────────────────────────────────────

export type Suit = '♠' | '♥' | '♦' | '♣' | 'joker'
export type Value =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A'
  | 'small' | 'big'

export interface Card {
  id: string      // e.g. "1-♠-7"
  suit: Suit
  value: Value
  deck: 1 | 2
  points: number  // 5→5, 10→10, K→10, else 0
}

export interface TrumpInfo {
  level: Value        // current level card e.g. '7'
  suit: Suit | null   // declared trump suit, null if not declared yet
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const VALUES: Value[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function cardPoints(value: Value): number {
  if (value === '5') return 5
  if (value === '10' || value === 'K') return 10
  return 0
}

// ─── Deck creation ────────────────────────────────────────────────────────────

export function createDeck(): Card[] {
  const cards: Card[] = []
  for (const deck of [1, 2] as const) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        cards.push({
          id: `${deck}-${suit}-${value}`,
          suit,
          value,
          deck,
          points: cardPoints(value),
        })
      }
    }
    // Small joker
    cards.push({ id: `${deck}-joker-small`, suit: 'joker', value: 'small', deck, points: 0 })
    // Big joker
    cards.push({ id: `${deck}-joker-big`, suit: 'joker', value: 'big', deck, points: 0 })
  }
  return cards // 108 cards total
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

export function shuffle(cards: Card[]): Card[] {
  const arr = [...cards]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ─── Deal ─────────────────────────────────────────────────────────────────────

export function dealCards(
  cards: Card[],
  numPlayers: 4 | 5,
): { hands: Card[][]; kitty: Card[] } {
  const kittySize = 8
  const handSize = numPlayers === 4 ? 25 : 20 // 4×25+8=108, 5×20+8=108
  const kitty = cards.slice(0, kittySize)
  const rest = cards.slice(kittySize)
  const hands: Card[][] = Array.from({ length: numPlayers }, (_, i) =>
    rest.slice(i * handSize, (i + 1) * handSize),
  )
  return { hands, kitty }
}

// ─── Trump analysis ───────────────────────────────────────────────────────────

export function isTrump(card: Card, trump: TrumpInfo): boolean {
  if (card.suit === 'joker') return true
  if (card.value === trump.level) return true // level card of ANY suit is trump
  if (trump.suit && card.suit === trump.suit) return true
  return false
}

/**
 * Returns a canonical "effective suit" string for grouping/following purposes.
 * All trump cards share the suit 'TRUMP'.
 */
export function getSuit(card: Card, trump: TrumpInfo): string {
  if (isTrump(card, trump)) return 'TRUMP'
  return card.suit as string
}

/** Alias kept for clarity in UI layers */
export function getTrumpSuit(_card: Card, _trump: TrumpInfo): string {
  return 'TRUMP'
}

/**
 * Returns a numeric rank for a card; higher = stronger.
 * Non-trump cards rank within their own suit 2(low)..A(high).
 * Trump cards get a higher base so they beat non-trump.
 */
export function getCardRank(card: Card, trump: TrumpInfo): number {
  const valueOrder: Record<Value, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
    '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14,
    'small': 0, 'big': 0,
  }

  if (!isTrump(card, trump)) {
    // Non-trump: just its face value
    return valueOrder[card.value]
  }

  // Trump hierarchy (high to low):
  // 1. Big joker        → 200
  // 2. Small joker      → 190
  // 3. Level card of trump suit → 180
  // 4. Level card of other suits → 170
  // 5. Trump suit A, K, Q, J, 10, 9, 8, (skip level), 6, 5, 4, 3, 2
  if (card.value === 'big') return 200
  if (card.value === 'small') return 190
  if (card.value === trump.level && card.suit === trump.suit) return 180
  if (card.value === trump.level) return 170

  // Normal trump-suit card (excluding the level card which is handled above)
  // Rank them 100 + face value, so they are between 100-150
  return 100 + valueOrder[card.value]
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

export function sortHand(cards: Card[], trump: TrumpInfo): Card[] {
  const suitOrder: Record<string, number> = { '♠': 1, '♥': 2, '♦': 3, '♣': 4, 'joker': 5, 'TRUMP': 6 }

  return [...cards].sort((a, b) => {
    const aTrump = isTrump(a, trump)
    const bTrump = isTrump(b, trump)

    if (aTrump !== bTrump) return aTrump ? 1 : -1 // trumps go to right side

    if (aTrump && bTrump) {
      return getCardRank(a, trump) - getCardRank(b, trump)
    }

    // Both non-trump: sort by suit then rank
    const aSuit = suitOrder[a.suit] ?? 99
    const bSuit = suitOrder[b.suit] ?? 99
    if (aSuit !== bSuit) return aSuit - bSuit
    return getCardRank(a, trump) - getCardRank(b, trump)
  })
}

// ─── Display ─────────────────────────────────────────────────────────────────

export function getCardDisplay(card: Card): { label: string; color: string } {
  if (card.value === 'big') return { label: '大王', color: 'text-red-500' }
  if (card.value === 'small') return { label: '小王', color: 'text-blue-500' }
  const isRed = card.suit === '♥' || card.suit === '♦'
  return {
    label: `${card.value}${card.suit}`,
    color: isRed ? 'text-red-500' : 'text-zinc-900',
  }
}

// ─── Following rules ──────────────────────────────────────────────────────────

/**
 * Determine the "structure" of a set of cards:
 * - single, pair, or tractor (consecutive pairs of same effective suit / rank)
 */
function cardStructure(
  cards: Card[],
  trump: TrumpInfo,
): 'single' | 'pair' | 'tractor' | 'mixed' {
  if (cards.length === 1) return 'single'
  if (cards.length === 2) {
    if (
      cards[0].value === cards[1].value &&
      getSuit(cards[0], trump) === getSuit(cards[1], trump)
    )
      return 'pair'
    return 'mixed'
  }
  if (cards.length >= 4 && cards.length % 2 === 0) {
    // Check for tractor: sorted pairs of same suit where ranks are consecutive
    const sorted = [...cards].sort(
      (a, b) => getCardRank(a, trump) - getCardRank(b, trump),
    )
    const suit = getSuit(sorted[0], trump)
    if (sorted.some((c) => getSuit(c, trump) !== suit)) return 'mixed'
    // Must form consecutive pairs
    for (let i = 0; i < sorted.length - 1; i += 2) {
      if (
        sorted[i].value !== sorted[i + 1].value ||
        getSuit(sorted[i], trump) !== getSuit(sorted[i + 1], trump)
      )
        return 'mixed'
    }
    // Check consecutive pair ranks
    const pairRanks: number[] = []
    for (let i = 0; i < sorted.length; i += 2) {
      pairRanks.push(getCardRank(sorted[i], trump))
    }
    for (let i = 1; i < pairRanks.length; i++) {
      if (pairRanks[i] - pairRanks[i - 1] !== 1) return 'mixed'
    }
    return 'tractor'
  }
  return 'mixed'
}

/** Count how many cards of a given effective suit are in hand */
function countSuit(hand: Card[], suit: string, trump: TrumpInfo): number {
  return hand.filter((c) => getSuit(c, trump) === suit).length
}

/** Count pairs of a given effective suit in hand */
function countPairs(hand: Card[], suit: string, trump: TrumpInfo): number {
  const suitCards = hand.filter((c) => getSuit(c, trump) === suit)
  const valueMap = new Map<string, number>()
  for (const c of suitCards) {
    const key = `${c.value}-${getSuit(c, trump)}`
    valueMap.set(key, (valueMap.get(key) ?? 0) + 1)
  }
  let pairs = 0
  for (const count of valueMap.values()) pairs += Math.floor(count / 2)
  return pairs
}

export function canFollow(
  hand: Card[],
  led: Card[],
  trump: TrumpInfo,
): boolean {
  if (led.length === 0) return true
  const ledSuit = getSuit(led[0], trump)
  const inHand = countSuit(hand, ledSuit, trump)
  return inHand > 0
}

export function isValidPlay(
  hand: Card[],
  played: Card[],
  led: Card[],
  trump: TrumpInfo,
  isLeading: boolean,
): boolean {
  if (isLeading) return played.length > 0

  // Verify all played cards are actually in hand
  const handIds = new Set(hand.map((c) => c.id))
  if (!played.every((c) => handIds.has(c.id))) return false
  if (played.length !== led.length) return false

  const ledSuit = getSuit(led[0], trump)
  const ledStructure = cardStructure(led, trump)
  const inHand = countSuit(hand, ledSuit, trump)

  // If player has no cards of that suit, anything is valid
  if (inHand === 0) return true

  // Must use as many cards of led suit as possible
  const playedInSuit = played.filter((c) => getSuit(c, trump) === ledSuit).length
  const shouldPlayInSuit = Math.min(inHand, led.length)
  if (playedInSuit < shouldPlayInSuit) return false

  if (ledStructure === 'pair') {
    const pairs = countPairs(hand, ledSuit, trump)
    if (pairs >= 1) {
      // Must play a pair of that suit
      const playedPairs = countPairs(played, ledSuit, trump)
      if (playedPairs < 1) return false
    }
  }

  if (ledStructure === 'tractor') {
    // Simplified: if you have a tractor in that suit, you must play it
    // (Full tractor detection is complex; here we just enforce pair-following)
    const pairs = countPairs(hand, ledSuit, trump)
    const neededPairs = led.length / 2
    const playedPairs = countPairs(played, ledSuit, trump)
    if (playedPairs < Math.min(pairs, neededPairs)) return false
  }

  return true
}

// ─── Trick resolution ────────────────────────────────────────────────────────

export function getTrickWinner(
  plays: { playerId: string; cards: Card[] }[],
  trump: TrumpInfo,
  leadPlayerId: string,
): string {
  const leadPlay = plays.find((p) => p.playerId === leadPlayerId)!
  const leadSuit = getSuit(leadPlay.cards[0], trump)
  const leadRank = Math.max(...leadPlay.cards.map((c) => getCardRank(c, trump)))

  let winnerId = leadPlayerId
  let winnerRank = leadRank
  let winnerIsTrump = isTrump(leadPlay.cards[0], trump)

  for (const play of plays) {
    if (play.playerId === leadPlayerId) continue
    const firstCard = play.cards[0]
    const playSuit = getSuit(firstCard, trump)
    const playRank = Math.max(...play.cards.map((c) => getCardRank(c, trump)))
    const playIsTrump = isTrump(firstCard, trump)

    if (playIsTrump && !winnerIsTrump) {
      // Trump beats non-trump
      winnerId = play.playerId
      winnerRank = playRank
      winnerIsTrump = true
    } else if (playIsTrump && winnerIsTrump && playRank > winnerRank) {
      // Higher trump wins
      winnerId = play.playerId
      winnerRank = playRank
    } else if (
      !playIsTrump &&
      !winnerIsTrump &&
      playSuit === leadSuit &&
      playRank > winnerRank
    ) {
      // Higher card of the led suit wins
      winnerId = play.playerId
      winnerRank = playRank
    }
  }

  return winnerId
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export function countPoints(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + c.points, 0)
}

/**
 * Returns the combo label for a set of cards being led.
 * Used for 甩牌 hints in the UI.
 */
export function getComboLabel(cards: Card[], trump: TrumpInfo): string | null {
  if (cards.length === 0) return null
  const s = cardStructure(cards, trump)
  if (s === 'single') return null // no hint needed for singles
  if (s === 'pair') return '对子'
  if (s === 'tractor') return '拖拉机！'
  // Mixed multi-card lead = 甩牌
  if (cards.length > 1) return '甩牌'
  return null
}
