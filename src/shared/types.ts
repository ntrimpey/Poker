export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export type HandPhase =
  | "lobby"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "handOver";

export type PlayerActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in";

export interface Card {
  rank: Rank;
  suit: Suit;
  code: string;
}

export interface PublicPlayer {
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
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  cardCount: number;
  cards?: Card[];
}

export interface ActionRecord {
  id: string;
  actor: string;
  message: string;
  amount?: number;
  createdAt: number;
}

export interface AvailableActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  minBet: number;
  minRaiseTo: number;
  maxBet: number;
  isPlayersTurn: boolean;
}

export interface RoomSnapshot {
  roomCode: string;
  phase: HandPhase;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  turnSeat: number | null;
  pot: number;
  currentBet: number;
  minRaise: number;
  communityCards: Card[];
  players: PublicPlayer[];
  actionLog: ActionRecord[];
  canStart: boolean;
  winnerMessage: string | null;
  joinUrl: string;
}

export interface PlayerSnapshot extends RoomSnapshot {
  playerId: string;
  holeCards: Card[];
  availableActions: AvailableActions;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
  playerId?: string;
}

export interface PlayerActionPayload {
  roomCode: string;
  playerId: string;
  type: PlayerActionType;
  amount?: number;
}

export type SocketAck<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
