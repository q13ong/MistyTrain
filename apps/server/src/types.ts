import type {
  ActionLog,
  BotDifficulty,
  BoardMap,
  ControlState,
  DeathReason,
  Direction,
  DoorLockState,
  HookSignal,
  ItemId,
  MapId,
  MemberKind,
  PlayerResult,
  Position,
  ReplayEvent,
  RoomPhase,
} from "@fog-train/shared";

export interface RoomSettings {
  turnTimeoutMs: number;
  reconnectGraceMs: number;
  maxSpectators: number;
}

export interface MemberState {
  userId: string;
  nickname: string;
  color: string;
  kind: MemberKind;
  control: ControlState;
  ready: boolean;
  joinOrder: number;
  disconnectedAt: string | null;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  isGoldenBot: boolean;
}

export interface ParticipantState {
  id: string;
  userId: string;
  nickname: string;
  color: string;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  isGoldenBot: boolean;
  roleId: string;
  position: Position | null;
  initialPosition: Position | null;
  finalPosition: Position | null;
  alive: boolean;
  waterCountdown: number;
  drankThisRound: boolean;
  placedSectionId: string | null;
  placementComplete: boolean;
  finalRank: number | null;
  survivedRounds: number;
  moveCount: number;
  skillUseCount: number;
  killCount: number;
  waterCount: number;
  deathRound: number | null;
  deathReason: DeathReason | null;
  ammo: number;
  paintUsesRemaining: number;
  paintSpreadRoundsRemaining: number;
  lockUsesRemaining: number;
  lastLockRound: number | null;
  fogVisionUsesRemaining: number;
  lastFogVisionRound: number | null;
  hasBackpack: boolean;
  prophecyBallAvailable: boolean;
  invisibilityCloakAvailable: boolean;
  bookIds: string[];
}

export interface BookState {
  id: string;
  ownerParticipantId: string;
  holderParticipantId: string | null;
  position: Position | null;
  readsRemaining: number;
  throwerMarkers: Array<{
    id: string;
    throwerParticipantId: string;
    position: Position;
    active: boolean;
    createdAt: string;
  }>;
}

export interface PendingFogVision {
  id: string;
  casterParticipantId: string;
  casterNickname: string;
  deadlineAt: string;
  sorcererParticipantId: string | null;
  responded: boolean;
  prophecyBallUsed: boolean;
  invisibilityUsed: boolean;
  rawPositions: Array<{ participantId: string; position: Position }>;
  createdAt: string;
}

export interface ActiveFogVision {
  id: string;
  casterParticipantId: string;
  round: number;
  positions: Position[];
  createdAt: string;
}

export interface ReadingMarkState {
  id: string;
  ownerParticipantId: string;
  targetParticipantId: string;
  roleId: string;
  position: Position;
  createdRound: number;
  createdAt: string;
}

export interface GameState {
  id: string;
  seed: string;
  rngCounter: number;
  mapId: MapId;
  map: BoardMap;
  phase: "role_select" | "placement" | "playing" | "finished";
  participantOrder: string[];
  participants: Record<string, ParticipantState>;
  currentRound: number;
  completedRounds: number;
  placementIndex: number;
  currentTurnIndex: number;
  currentTurnParticipantId: string | null;
  currentTurnStartedAt: string | null;
  deadlineAt: string | null;
  winnerParticipantIds: string[];
  finishedAt: string | null;
  seq: number;
  actions: ActionLog[];
  events: ReplayEvent[];
  lockedDoors: Record<string, DoorLockState>;
  paintTiles: Position[];
  paintTileMeta: Record<
    string,
    {
      createdRound: number;
      creatorParticipantId: string;
      source: "skill" | "spread";
    }
  >;
  gunshotSignals: Position[];
  hookSignals: HookSignal[];
  books: Record<string, BookState>;
  readingMarks: Record<string, ReadingMarkState>;
  pendingFogVision: PendingFogVision | null;
  fogViews: Record<string, ActiveFogVision>;
  conductorActionCounts: Record<string, number>;
}

export interface RoomMessageState {
  id: string;
  userId: string;
  nickname: string;
  phraseId: string;
  text: string;
  createdAt: string;
}

export interface RoomState {
  version: 1;
  id: string;
  code: string;
  mapId: MapId;
  hostUserId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  initialPlayerCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  closedAt: string | null;
  seq: number;
  members: MemberState[];
  messages: RoomMessageState[];
  game: GameState | null;
  processedCommands: Record<string, { at: string; roomSeq: number }>;
}

export type EngineEventType =
  | "phase_changed"
  | "activity"
  | "round_started"
  | "round_ended"
  | "death"
  | "actor_moved"
  | "drank"
  | "game_finished"
  | "replay_ready"
  | "placement_completed"
  | "phrase"
  | "role_selected"
  | "skill_used"
  | "door_locked"
  | "door_unlocked"
  | "paint_applied"
  | "gunshot"
  | "hook_used"
  | "item_used"
  | "book_thrown"
  | "book_picked_up"
  | "book_dropped"
  | "book_marker_cleared"
  | "reading_marked"
  | "fog_response"
  | "fog_resolved"
  | "chat"
  | "fog_vision_used"
  | "fog_vision_ended"
  | "map_selected";

export interface EngineEvent {
  type: EngineEventType;
  round: number | null;
  actorParticipantId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EngineResult {
  events: EngineEvent[];
  actions: ActionLog[];
}

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
}
