import type {
  ActionLog,
  BoardMap,
  BookMarkerView,
  BotDifficulty,
  ControlState,
  DeathPublicReason,
  Direction,
  DoorLockState,
  GameMapDefinition,
  HookSignal,
  MapId,
  MemberKind,
  PlayerResult,
  Position,
  ReadingMarkView,
  RoleDefinition,
  RoomPhase,
  SkillId,
  SkillUseTarget,
} from "../game/types";

export interface PublicMember {
  userId: string;
  participantId: string | null;
  nickname: string;
  color: string;
  kind: MemberKind;
  controlState: ControlState;
  roleId: string | null;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  isGoldenBot: boolean;
  ready: boolean;
  isHost: boolean;
  joinOrder: number;
}

export interface PublicActor {
  participantId: string;
  nickname: string;
}

export interface PublicDeath {
  participantId: string;
  nickname: string;
  reason: DeathPublicReason;
}

export interface FogSectionHint {
  direction: "above" | "below";
  sectionId: string;
  sectionLabel: string;
  count: number;
}

export interface LeaderboardEntry {
  userId: string;
  nickname: string;
  rating: number;
  gamesPlayed: number;
  bestRoleId: string | null;
  bestRoleName: string;
  bestRoleWinRate: number;
  bestRoleWins: number;
  bestRoleGames: number;
  averageKd: number;
}

export interface SelfPlayerState {
  participantId: string;
  position: Position | null;
  roleId: string;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  waterCountdown: number;
  legalMoves: Direction[];
  isCurrentTurn: boolean;
  visibleSectionIds: string[];
  skill: {
    skillIds: SkillId[];
    ammo: number;
    paintUsesRemaining: number;
    paintSpreadRoundsRemaining: number;
    lockUsesRemaining: number;
    lockUsedThisRound: boolean;
    canUseSkill: boolean;
    unavailableReason: string | null;
  };
  fogVision: {
    usesRemaining: number;
    usedThisRound: boolean;
    canUse: boolean;
    unavailableReason: string | null;
    pending: boolean;
    canRespond: boolean;
    responded: boolean;
    prophecyBallAvailable: boolean;
    invisibilityCloakAvailable: boolean;
    revealedPositions: Position[];
    sectionHints: FogSectionHint[];
  };
  items: {
    hasBackpack: boolean;
    prophecyBallAvailable: boolean;
    invisibilityCloakAvailable: boolean;
    bookIds: string[];
    readUsesRemaining: number;
    bookMarkers: BookMarkerView[];
    readingMark: ReadingMarkView | null;
  };
}

export interface FullPlayerState {
  participantId: string;
  nickname: string;
  color: string;
  position: Position;
  alive: boolean;
  roleId: string;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  online: boolean;
  waterCountdown?: number;
  paintSpreadRoundsRemaining: number;
}

export interface RoomSnapshot {
  roomId: string;
  roomCode: string;
  phase: RoomPhase;
  hostUserId: string;
  members: PublicMember[];
  settings: {
    turnTimeoutMs: number;
    reconnectGraceMs: number;
    maxSpectators: number;
  };
  initialPlayerCount: number | null;
  currentRound: number;
  completedRounds: number;
  aliveCount: number;
  turnOrder: PublicActor[];
  mapId: MapId;
  mapName: string;
  maps: GameMapDefinition[];
  roles: RoleDefinition[];
  selectedRoleId: string | null;
  placement: {
    occupiedSectionIds: string[];
    selectedSectionId: string | null;
    selectedPosition: Position | null;
  } | null;
  map: BoardMap | null;
  lockedDoors: DoorLockState[];
  paintTiles: Position[];
  gunshotSignals: Position[];
  hookSignals: HookSignal[];
  fog: {
    status: "pending" | "active";
    deadlineAt: string | null;
    casterParticipantId: string;
    canRespond: boolean;
    responded: boolean;
  } | null;
  spectatorMap: boolean;
  players?: FullPlayerState[];
  self?: SelfPlayerState;
  winnerParticipantIds: string[];
  deadlineAt: string | null;
  currentActor: PublicActor | null;
  messages: Array<{
    id: string;
    userId: string;
    nickname: string;
    phraseId: string;
    text: string;
    createdAt: string;
  }>;
  leaderboard?: PlayerResult[];
  canEndBotOnlyGame: boolean;
}

export interface CommandEnvelope<T = unknown> {
  commandId: string;
  roomId: string;
  turnId?: string;
  payload: T;
}

export interface CommandAck {
  ok: boolean;
  code?: string;
  message?: string;
  roomSeq?: number;
}

export interface ClientToServerEvents {
  "room:sync": (
    payload: { roomId: string },
    ack: (response: CommandAck) => void,
  ) => void;
  "room:leave": (
    payload: CommandEnvelope,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:ready": (
    payload: CommandEnvelope<{ ready: boolean }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:start": (
    payload: CommandEnvelope,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:chat": (
    payload: CommandEnvelope<{ text: string }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:rematch": (
    payload: CommandEnvelope,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:end_bot_game": (
    payload: CommandEnvelope,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:add_bot": (
    payload: CommandEnvelope<{ difficulty: BotDifficulty }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "room:remove_bot": (
    payload: CommandEnvelope<{ botUserId: string }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "role:select": (
    payload: CommandEnvelope<{ roleId: string }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "placement:choose_section": (
    payload: CommandEnvelope<{ sectionId: string }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "placement:choose_cell": (
    payload: CommandEnvelope<{ position: Position }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:move": (
    payload: CommandEnvelope<{ direction: Direction }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:skill_use": (
    payload: CommandEnvelope<{ skillId: SkillId; target: SkillUseTarget }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:fog_response": (
    payload: CommandEnvelope<{ useProphecyBall: boolean; useInvisibility: boolean }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:book_throw": (
    payload: CommandEnvelope<{ direction: Direction }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:book_read": (
    payload: CommandEnvelope<{ targetParticipantId: string }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:fog_vision": (
    payload: CommandEnvelope,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:skill_target": (
    payload: CommandEnvelope<{ skillId: string; target: unknown }>,
    ack: (response: CommandAck) => void,
  ) => void;
  "game:skill_confirm": (
    payload: CommandEnvelope<{ skillId: string }>,
    ack: (response: CommandAck) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "room:member_updated": (member: PublicMember) => void;
  "room:online_changed": (payload: { userId: string; online: boolean }) => void;
  "room:host_changed": (payload: { hostUserId: string }) => void;
  "room:chat": (message: RoomSnapshot["messages"][number]) => void;
  "public:fog_vision_alert": (payload: {
    participantId: string;
    nickname?: string;
    status: "pending" | "resolved" | "ended";
    deadlineAt?: string | null;
  }) => void;
  "phase:changed": (payload: { phase: RoomPhase }) => void;
  "public:activity": (payload: {
    actor: PublicActor;
    phase: RoomPhase;
    deadlineAt: string | null;
  }) => void;
  "public:round_started": (payload: { round: number }) => void;
  "public:round_ended": (payload: { round: number }) => void;
  "public:death": (payload: PublicDeath) => void;
  "public:role_selected": (payload: {
    participantId: string;
    nickname: string;
    roleId: string;
    roleName: string;
  }) => void;
  "public:skill_used": (payload: {
    participantId: string;
    nickname: string;
    skillId: string;
    skillName: string;
  }) => void;
  "public:door_locked": (payload: {
    connectionId: string;
    remainingConductorTurns: number;
  }) => void;
  "public:paint_applied": (payload: { position: Position }) => void;
  "public:gunshot": (payload: { position: Position }) => void;
  "public:hook_used": (payload: { signal: HookSignal }) => void;
  "public:fog_vision_used": (payload: {
    participantId: string;
    nickname: string;
  }) => void;
  "public:game_finished": (payload: { leaderboard: PlayerResult[] }) => void;
  "game:self_state": (payload: SelfPlayerState) => void;
  "game:spectator_state": (payload: { map: BoardMap; players: FullPlayerState[] }) => void;
  "game:actor_moved": (payload: {
    participantId: string;
    from: Position;
    to: Position;
    direction: Direction;
    drank: boolean;
  }) => void;
  "game:skill_announced": (payload: Record<string, unknown>) => void;
  "game:skill_resolved": (payload: Record<string, unknown>) => void;
  "game:replay_ready": (payload: { roomCode: string }) => void;
  "action:error": (payload: { code: string; message: string }) => void;
  "session:replaced": () => void;
}
