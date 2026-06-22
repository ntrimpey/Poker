import {
  type ActionRecord,
  type AvailableActions,
  type Card,
  type HandPhase,
  type PlayerActionPayload,
  type PlayerSnapshot,
  type PublicPlayer,
  type Rank,
  type RoomSnapshot,
  type Suit,
} from "../shared/types";

const STARTING_STACK = 1_000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const ROOM_CODE_LENGTH = 5;
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export interface Player {
  id: string;
  name: string;
  seat: number;
  stack: number;
  bet: number;
  totalContribution: number;
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  inHand: boolean;
  holeCards: Card[];
}

export interface Room {
  roomCode: string;
  phase: HandPhase;
  handNumber: number;
  players: Player[];
  deck: Card[];
  communityCards: Card[];
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  turnSeat: number | null;
  pot: number;
  currentBet: number;
  minRaise: number;
  actedPlayerIds: Set<string>;
  actionLog: ActionRecord[];
  winnerMessage: string | null;
  joinOrigin: string;
}

export class PokerError extends Error {}

export function createRoom(roomCode: string, joinOrigin: string): Room {
  return {
    roomCode,
    phase: "lobby",
    handNumber: 0,
    players: [],
    deck: [],
    communityCards: [],
    dealerSeat: null,
    smallBlindSeat: null,
    bigBlindSeat: null,
    turnSeat: null,
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    actedPlayerIds: new Set(),
    actionLog: [],
    winnerMessage: null,
    joinOrigin,
  };
}

export function generateRoomCode(existingCodes: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!existingCodes.has(code)) {
      return code;
    }
  }

  throw new PokerError("Could not generate a unique room code.");
}

export function addOrReconnectPlayer(room: Room, name: string, playerId?: string): Player {
  const trimmedName = name.trim().slice(0, 20);
  if (!trimmedName) {
    throw new PokerError("Enter a display name.");
  }

  if (playerId) {
    const existingPlayer = room.players.find((player) => player.id === playerId);
    if (existingPlayer) {
      existingPlayer.name = trimmedName;
      existingPlayer.connected = true;
      return existingPlayer;
    }
  }

  const takenSeats = new Set(room.players.map((player) => player.seat));
  let seat = 1;
  while (takenSeats.has(seat)) {
    seat += 1;
  }

  const player: Player = {
    id: crypto.randomUUID(),
    name: trimmedName,
    seat,
    stack: STARTING_STACK,
    bet: 0,
    totalContribution: 0,
    folded: false,
    allIn: false,
    connected: true,
    inHand: false,
    holeCards: [],
  };

  room.players.push(player);
  addAction(room, "Table", `${player.name} sat down in seat ${seat}.`);
  return player;
}

export function setPlayerConnected(room: Room, playerId: string, connected: boolean): void {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (player) {
    player.connected = connected;
  }
}

export function startHand(room: Room): void {
  const seatedPlayers = orderedPlayers(room).filter((player) => player.stack > 0);
  if (seatedPlayers.length < 2) {
    throw new PokerError("At least two players with chips are required to start.");
  }

  room.handNumber += 1;
  room.phase = "preflop";
  room.deck = shuffle(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;
  room.actedPlayerIds = new Set();
  room.actionLog = [];
  room.winnerMessage = null;
  room.turnSeat = null;

  for (const player of room.players) {
    player.bet = 0;
    player.totalContribution = 0;
    player.folded = false;
    player.allIn = false;
    player.holeCards = [];
    player.inHand = player.stack > 0;
  }

  room.dealerSeat =
    room.dealerSeat === null
      ? seatedPlayers[0].seat
      : nextSeat(room, room.dealerSeat, (player) => player.stack > 0) ?? seatedPlayers[0].seat;

  if (seatedPlayers.length === 2) {
    room.smallBlindSeat = room.dealerSeat;
    room.bigBlindSeat = nextSeat(room, room.smallBlindSeat, (player) => player.inHand);
  } else {
    room.smallBlindSeat = nextSeat(room, room.dealerSeat, (player) => player.inHand);
    room.bigBlindSeat =
      room.smallBlindSeat === null
        ? null
        : nextSeat(room, room.smallBlindSeat, (player) => player.inHand);
  }

  const smallBlind = playerBySeat(room, room.smallBlindSeat);
  const bigBlind = playerBySeat(room, room.bigBlindSeat);
  if (!smallBlind || !bigBlind) {
    throw new PokerError("Could not assign blinds.");
  }

  postBlind(room, smallBlind, SMALL_BLIND, "small blind");
  postBlind(room, bigBlind, BIG_BLIND, "big blind");
  room.currentBet = Math.max(...room.players.filter((player) => player.inHand).map((player) => player.bet));

  for (let cardRound = 0; cardRound < 2; cardRound += 1) {
    for (const player of orderedPlayersStartingAfter(room, room.dealerSeat).filter((candidate) => candidate.inHand)) {
      player.holeCards.push(draw(room));
    }
  }

  room.turnSeat = nextActionSeat(room, room.bigBlindSeat);
  addAction(room, "Dealer", `Hand ${room.handNumber} started.`);
  settleIfBettingIsFinished(room);
}

export function applyPlayerAction(room: Room, payload: PlayerActionPayload): void {
  if (!isBettingPhase(room.phase)) {
    throw new PokerError("There is no active betting round.");
  }

  const player = room.players.find((candidate) => candidate.id === payload.playerId);
  if (!player || !player.inHand || player.folded || player.allIn) {
    throw new PokerError("Player is not active in this hand.");
  }

  if (player.seat !== room.turnSeat) {
    throw new PokerError("It is not your turn.");
  }

  const outstanding = Math.max(0, room.currentBet - player.bet);
  let message = "";
  let raised = false;
  let fullRaise = false;

  switch (payload.type) {
    case "fold":
      player.folded = true;
      message = "folded";
      break;
    case "check":
      if (outstanding > 0) {
        throw new PokerError("Check is only available when there is no bet to call.");
      }
      message = "checked";
      break;
    case "call": {
      if (outstanding <= 0) {
        throw new PokerError("There is nothing to call.");
      }
      const paid = takeChips(room, player, outstanding);
      message = paid < outstanding ? `called all-in for ${paid}` : `called ${paid}`;
      break;
    }
    case "bet": {
      if (room.currentBet > 0) {
        throw new PokerError("Use raise when a bet already exists.");
      }
      const targetBet = validateTargetBet(player, payload.amount, BIG_BLIND);
      const paid = takeChips(room, player, targetBet - player.bet);
      room.currentBet = player.bet;
      raised = player.bet > 0;
      fullRaise = paid >= BIG_BLIND;
      message = player.allIn ? `bet all-in for ${player.bet}` : `bet ${player.bet}`;
      break;
    }
    case "raise": {
      if (room.currentBet <= 0) {
        throw new PokerError("Use bet to open the action.");
      }
      const targetBet = validateTargetBet(player, payload.amount, room.currentBet + room.minRaise);
      const previousBet = room.currentBet;
      takeChips(room, player, targetBet - player.bet);
      const raiseSize = player.bet - previousBet;
      if (player.bet > previousBet) {
        room.currentBet = player.bet;
        raised = true;
        fullRaise = raiseSize >= room.minRaise;
        if (fullRaise) {
          room.minRaise = raiseSize;
        }
      }
      message = player.allIn ? `raised all-in to ${player.bet}` : `raised to ${player.bet}`;
      break;
    }
    case "all-in": {
      const previousBet = room.currentBet;
      const paid = takeChips(room, player, player.stack);
      const raiseSize = player.bet - previousBet;
      if (player.bet > previousBet) {
        room.currentBet = player.bet;
        raised = true;
        fullRaise = raiseSize >= room.minRaise;
        if (fullRaise) {
          room.minRaise = raiseSize;
        }
      }
      message = paid > 0 ? `moved all-in for ${player.bet}` : "is already all-in";
      break;
    }
    default:
      throw new PokerError("Unknown action.");
  }

  if (raised && fullRaise) {
    room.actedPlayerIds = new Set([player.id]);
  } else {
    room.actedPlayerIds.add(player.id);
  }

  addAction(room, player.name, message);
  settleIfBettingIsFinished(room, player.seat);
}

export function getRoomSnapshot(room: Room): RoomSnapshot {
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    handNumber: room.handNumber,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    dealerSeat: room.dealerSeat,
    smallBlindSeat: room.smallBlindSeat,
    bigBlindSeat: room.bigBlindSeat,
    turnSeat: room.turnSeat,
    pot: room.pot,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    communityCards: room.communityCards,
    players: orderedPlayers(room).map((player) => toPublicPlayer(room, player)),
    actionLog: room.actionLog.slice(-12).reverse(),
    canStart:
      (room.phase === "lobby" || room.phase === "handOver") &&
      room.players.filter((player) => player.stack > 0).length >= 2,
    winnerMessage: room.winnerMessage,
    joinUrl: buildJoinUrl(room),
  };
}

export function getPlayerSnapshot(room: Room, playerId: string): PlayerSnapshot {
  const player = room.players.find((candidate) => candidate.id === playerId);
  const base = getRoomSnapshot(room);

  return {
    ...base,
    playerId,
    holeCards: player?.holeCards ?? [],
    availableActions: player ? getAvailableActions(room, player) : emptyActions(),
  };
}

function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      rank,
      suit,
      code: `${rank}${suit[0].toUpperCase()}`,
    })),
  );
}

function shuffle(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function draw(room: Room): Card {
  const card = room.deck.pop();
  if (!card) {
    throw new PokerError("The deck is empty.");
  }
  return card;
}

function postBlind(room: Room, player: Player, amount: number, label: string): void {
  const paid = takeChips(room, player, amount);
  addAction(room, player.name, `posted ${label} ${paid}.`);
}

function takeChips(room: Room, player: Player, requestedAmount: number): number {
  const amount = Math.max(0, Math.min(requestedAmount, player.stack));
  player.stack -= amount;
  player.bet += amount;
  player.totalContribution += amount;
  room.pot += amount;
  if (player.stack === 0) {
    player.allIn = true;
  }
  return amount;
}

function validateTargetBet(player: Player, amount: number | undefined, minimumTarget: number): number {
  if (amount === undefined || Number.isNaN(amount)) {
    throw new PokerError("Enter an amount.");
  }

  const targetBet = Math.floor(amount);
  const maxTarget = player.bet + player.stack;
  if (targetBet <= player.bet) {
    throw new PokerError("Amount must be more than your current bet.");
  }

  if (targetBet < minimumTarget && targetBet < maxTarget) {
    throw new PokerError(`Minimum amount is ${minimumTarget}, unless you are all-in.`);
  }

  return Math.min(targetBet, maxTarget);
}

function settleIfBettingIsFinished(room: Room, lastSeat?: number): void {
  const contenders = inHandPlayers(room).filter((player) => !player.folded);
  if (contenders.length === 1) {
    awardUncontested(room, contenders[0]);
    return;
  }

  if (contenders.length > 1 && actionPlayers(room).length <= 1 && everyoneMatchedOrAllIn(room)) {
    dealRemainingAndShowdown(room);
    return;
  }

  if (isBettingRoundComplete(room)) {
    advanceStreet(room);
    return;
  }

  room.turnSeat = nextActionSeat(room, lastSeat ?? room.turnSeat);
}

function advanceStreet(room: Room): void {
  for (const player of room.players) {
    player.bet = 0;
  }
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;
  room.actedPlayerIds = new Set();

  if (room.phase === "preflop") {
    room.communityCards.push(draw(room), draw(room), draw(room));
    room.phase = "flop";
    addAction(room, "Dealer", "dealt the flop.");
  } else if (room.phase === "flop") {
    room.communityCards.push(draw(room));
    room.phase = "turn";
    addAction(room, "Dealer", "dealt the turn.");
  } else if (room.phase === "turn") {
    room.communityCards.push(draw(room));
    room.phase = "river";
    addAction(room, "Dealer", "dealt the river.");
  } else {
    dealRemainingAndShowdown(room);
    return;
  }

  if (actionPlayers(room).length <= 1) {
    dealRemainingAndShowdown(room);
    return;
  }

  room.turnSeat = nextActionSeat(room, room.dealerSeat);
}

function dealRemainingAndShowdown(room: Room): void {
  while (room.communityCards.length < 5) {
    room.communityCards.push(draw(room));
  }

  for (const player of room.players) {
    player.bet = 0;
  }

  room.currentBet = 0;
  room.turnSeat = null;
  room.phase = "showdown";
  settleShowdown(room);
  room.phase = "handOver";
}

function awardUncontested(room: Room, winner: Player): void {
  const amount = room.pot;
  winner.stack += amount;
  room.pot = 0;
  room.turnSeat = null;
  room.phase = "handOver";
  room.winnerMessage = `${winner.name} wins ${amount}.`;
  addAction(room, "Dealer", room.winnerMessage);
}

function settleShowdown(room: Room): void {
  const payouts = new Map<string, number>();
  const levels = [...new Set(inHandPlayers(room).map((player) => player.totalContribution).filter(Boolean))].sort(
    (a, b) => a - b,
  );
  let previousLevel = 0;

  for (const level of levels) {
    const contributors = inHandPlayers(room).filter((player) => player.totalContribution >= level);
    const sidePot = (level - previousLevel) * contributors.length;
    const eligiblePlayers = contributors.filter((player) => !player.folded);
    previousLevel = level;

    if (sidePot <= 0 || eligiblePlayers.length === 0) {
      continue;
    }

    const winners = findBestPlayers(eligiblePlayers, room.communityCards);
    const share = Math.floor(sidePot / winners.length);
    const remainder = sidePot % winners.length;
    winners
      .sort((a, b) => a.seat - b.seat)
      .forEach((winner, index) => {
        const amount = share + (index === 0 ? remainder : 0);
        winner.stack += amount;
        payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + amount);
      });
  }

  room.pot = 0;
  const payoutMessages = [...payouts.entries()]
    .map(([playerId, amount]) => `${room.players.find((player) => player.id === playerId)?.name ?? "Player"} wins ${amount}`)
    .join(", ");
  room.winnerMessage = payoutMessages || "The hand ended without a winner.";
  addAction(room, "Dealer", room.winnerMessage);
}

function findBestPlayers(players: Player[], communityCards: Card[]): Player[] {
  const scored = players.map((player) => ({
    player,
    score: evaluateBestHand([...player.holeCards, ...communityCards]),
  }));
  const bestScore = scored.reduce((best, current) => (compareScore(current.score, best) > 0 ? current.score : best), scored[0].score);
  return scored.filter((entry) => compareScore(entry.score, bestScore) === 0).map((entry) => entry.player);
}

function evaluateBestHand(cards: Card[]): number[] {
  const hands = fiveCardCombinations(cards);
  return hands
    .map(scoreFiveCards)
    .reduce((best, score) => (compareScore(score, best) > 0 ? score : best), scoreFiveCards(hands[0]));
}

function fiveCardCombinations(cards: Card[]): Card[][] {
  const combinations: Card[][] = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            combinations.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return combinations;
}

function scoreFiveCards(cards: Card[]): number[] {
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const counts = [...new Set(values)]
    .map((value) => ({ value, count: values.filter((candidate) => candidate === value).length }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const isFlush = new Set(cards.map((card) => card.suit)).size === 1;
  const straightHigh = getStraightHigh(values);

  if (isFlush && straightHigh) return [8, straightHigh];
  if (counts[0].count === 4) return [7, counts[0].value, counts[1].value];
  if (counts[0].count === 3 && counts[1].count === 2) return [6, counts[0].value, counts[1].value];
  if (isFlush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (counts[0].count === 3) {
    return [3, counts[0].value, ...counts.slice(1).map((entry) => entry.value).sort((a, b) => b - a)];
  }
  if (counts[0].count === 2 && counts[1].count === 2) {
    const pairs = counts.filter((entry) => entry.count === 2).map((entry) => entry.value);
    const kicker = counts.find((entry) => entry.count === 1)?.value ?? 0;
    return [2, ...pairs, kicker];
  }
  if (counts[0].count === 2) {
    return [1, counts[0].value, ...counts.slice(1).map((entry) => entry.value).sort((a, b) => b - a)];
  }
  return [0, ...values];
}

function getStraightHigh(values: number[]): number | null {
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  if (uniqueValues.includes(14)) {
    uniqueValues.push(1);
  }

  for (let index = 0; index <= uniqueValues.length - 5; index += 1) {
    const run = uniqueValues.slice(index, index + 5);
    if (run.every((value, runIndex) => runIndex === 0 || value === run[runIndex - 1] - 1)) {
      return run[0];
    }
  }

  return null;
}

function compareScore(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isBettingRoundComplete(room: Room): boolean {
  const playersToAct = actionPlayers(room);
  if (playersToAct.length === 0) {
    return true;
  }

  return playersToAct.every((player) => player.bet === room.currentBet && room.actedPlayerIds.has(player.id));
}

function everyoneMatchedOrAllIn(room: Room): boolean {
  return inHandPlayers(room)
    .filter((player) => !player.folded)
    .every((player) => player.allIn || player.bet === room.currentBet);
}

function isBettingPhase(phase: HandPhase): boolean {
  return phase === "preflop" || phase === "flop" || phase === "turn" || phase === "river";
}

function actionPlayers(room: Room): Player[] {
  return inHandPlayers(room).filter((player) => !player.folded && !player.allIn);
}

function inHandPlayers(room: Room): Player[] {
  return orderedPlayers(room).filter((player) => player.inHand);
}

function orderedPlayers(room: Room): Player[] {
  return [...room.players].sort((a, b) => a.seat - b.seat);
}

function orderedPlayersStartingAfter(room: Room, seat: number | null): Player[] {
  const ordered = orderedPlayers(room);
  if (seat === null || ordered.length === 0) {
    return ordered;
  }

  const index = ordered.findIndex((player) => player.seat === seat);
  if (index === -1) {
    return ordered;
  }
  return [...ordered.slice(index + 1), ...ordered.slice(0, index + 1)];
}

function nextSeat(room: Room, fromSeat: number | null, predicate: (player: Player) => boolean): number | null {
  const nextPlayer = orderedPlayersStartingAfter(room, fromSeat).find(predicate);
  return nextPlayer?.seat ?? null;
}

function nextActionSeat(room: Room, fromSeat: number | null): number | null {
  return nextSeat(room, fromSeat, (player) => player.inHand && !player.folded && !player.allIn);
}

function playerBySeat(room: Room, seat: number | null): Player | undefined {
  return room.players.find((player) => player.seat === seat);
}

function toPublicPlayer(room: Room, player: Player): PublicPlayer {
  const showCards = room.phase === "handOver" && player.inHand && !player.folded;

  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    stack: player.stack,
    bet: player.bet,
    totalContribution: player.totalContribution,
    folded: player.folded,
    allIn: player.allIn,
    connected: player.connected,
    inHand: player.inHand,
    isDealer: player.seat === room.dealerSeat,
    isSmallBlind: player.seat === room.smallBlindSeat,
    isBigBlind: player.seat === room.bigBlindSeat,
    cardCount: player.holeCards.length,
    cards: showCards ? player.holeCards : undefined,
  };
}

function getAvailableActions(room: Room, player: Player): AvailableActions {
  if (
    !isBettingPhase(room.phase) ||
    !player.inHand ||
    player.folded ||
    player.allIn ||
    player.seat !== room.turnSeat
  ) {
    return emptyActions();
  }

  const callAmount = Math.max(0, room.currentBet - player.bet);
  const maxBet = player.bet + player.stack;

  return {
    canFold: true,
    canCheck: callAmount === 0,
    canCall: callAmount > 0 && player.stack > 0,
    callAmount,
    minBet: room.currentBet === 0 ? Math.min(BIG_BLIND, maxBet) : 0,
    minRaiseTo: room.currentBet > 0 ? Math.min(room.currentBet + room.minRaise, maxBet) : 0,
    maxBet,
    isPlayersTurn: true,
  };
}

function emptyActions(): AvailableActions {
  return {
    canFold: false,
    canCheck: false,
    canCall: false,
    callAmount: 0,
    minBet: 0,
    minRaiseTo: 0,
    maxBet: 0,
    isPlayersTurn: false,
  };
}

function addAction(room: Room, actor: string, message: string, amount?: number): void {
  room.actionLog.push({
    id: crypto.randomUUID(),
    actor,
    message,
    amount,
    createdAt: Date.now(),
  });
  room.actionLog = room.actionLog.slice(-30);
}

function buildJoinUrl(room: Room): string {
  const url = new URL(room.joinOrigin || "http://localhost:3000");
  url.searchParams.set("room", room.roomCode);
  return url.toString();
}
