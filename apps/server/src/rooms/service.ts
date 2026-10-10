/**
 * 房间编排层。
 *
 * GameEngine 负责规则结算；本文件负责房间生命周期、持久化和可见性投影：
 * - 准备、开局、重连、房主转移和超时；
 * - 把状态变更写入事件、行动日志与快照；
 * - 为不同观看者生成不同的 RoomSnapshot；
 * - 最后一个玩家离开后删除整间房。
 *
 * 真实位置只存在于服务端 RoomState/GameState，不会直接广播原始状态。
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  PHRASES,
  DEFAULT_MAP_ID,
  MAP_REGISTRY,
  ROLE_CONDUCTOR,
  ROLE_UNLUCKY,
  ROLE_REGISTRY,
  SKILL_REGISTRY,
  getSectionAt,
  getVisibleSectionIds,
  type CommandAck,
  type BotDifficulty,
  type FogSectionHint,
  type MapId,
  type PlayerResult,
  type Position,
  type PublicMember,
  type RoomSnapshot,
} from "@fog-train/shared";
import type {
  EngineEvent,
  EngineResult,
  GameState,
  MemberState,
  ParticipantState,
  RoomState,
  RoomSettings,
  ActiveFogVision,
} from "../types";
import {
  aliveParticipants,
  applyMove,
  applyTurnTimeout,
  choosePlacementCell,
  choosePlacementSection,
  chooseRole,
  readBook,
  createGame,
  currentPlacementParticipant,
  currentTurnParticipant,
  finishBotOnlyGame,
  fogVisionUnavailableReason,
  findParticipantByUser,
  getLeaderboard,
  killParticipant,
  legalMovementDirections,
  roomPlayers,
  respondToFogVision,
  skillUnavailableReason,
  startRoleSelection,
  useSkill,
  useFogVision,
  throwBook,
} from "../game/engine";
import { legalDirections } from "../game/rules";
import type { BotController } from "../bots/controller";
import { chooseBotName, GOLDEN_BOT_NAME } from "../bots/names";
import {
  findLatestSnapshotByRoomId,
  findRoomByCode,
  deleteRoomData,
  deleteGameHistory,
  loadLatestRoomSnapshots,
  saveGameAction,
  saveGameEvent,
  saveGameParticipant,
  savePlayerGameResults,
  saveRoomMessage,
  saveRoomSnapshot,
} from "../db/repository";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MEMBER_COLORS = [
  "#e45756",
  "#4c78a8",
  "#f58518",
  "#54a24b",
  "#b279a2",
  "#eeca3b",
  "#72b7b2",
  "#ff9da6",
];

export interface RoomUser {
  id: string;
  nickname: string;
}

export interface RoomChange {
  events: EngineEvent[];
  actions: EngineResult["actions"];
}

type ChangeHandler = (room: RoomState, change: RoomChange) => void | Promise<void>;

function commandError(error: unknown): CommandAck {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const messages: Record<string, string> = {
    ROOM_NOT_FOUND: "房间不存在",
    ROOM_CLOSED: "房间已关闭",
    NOT_A_MEMBER: "你不在这个房间中",
    NOT_HOST: "只有房主可以开始游戏",
    PLAYER_COUNT: "玩家人数必须为 2 至 8 人",
    INVALID_BOT_DIFFICULTY: "机器人难度无效",
    NOT_A_BOT: "目标不是电脑玩家",
    BOT_NAMES_EXHAUSTED: "机器人昵称池已用尽",
    PLAYER_NOT_READY: "仍有玩家没有准备",
    PLAYER_OFFLINE: "仍有玩家处于断线状态",
    WRONG_PHASE: "当前阶段不能执行该操作",
    NOT_YOUR_TURN: "还没有轮到你",
    UNKNOWN_ROLE: "角色不存在",
    ROLE_UNAVAILABLE: "该角色尚未开放",
    ROLE_MAP_LOCKED: "该角色不适用于当前地图",
    MAP_UNAVAILABLE: "该地图尚未开放",
    PLAYER_NOT_ALIVE: "你已不能操作",
    CORPSE_CANNOT_MOVE: "尸体不能移动",
    INVALID_SECTION: "无效的车厢",
    SECTION_OCCUPIED: "该车厢已被选择",
    SECTION_ALREADY_CHOSEN: "你已经选过车厢",
    SECTION_NOT_CHOSEN: "请先选择车厢",
    INVALID_CELL: "该格子不在已选车厢中",
    CELL_OCCUPIED: "该格子已被选择",
    ILLEGAL_MOVE: "该方向不能移动",
    PLAYER_HAS_NO_POSITION: "尚未完成初始选位",
    SPECTATOR_READ_ONLY: "观战者不能操作或发言",
    DEAD_READ_ONLY: "死亡玩家不能操作或发言",
    PHRASE_RATE_LIMIT: "发言太快了",
    ROOM_FULL: "观战人数已满",
    DOOR_LOCKED: "该连接处已被锁住",
    UNKNOWN_SKILL: "未知技能",
    SKILL_UNAVAILABLE: "当前无法使用技能",
    INVALID_SKILL_TARGET: "技能目标无效",
    ROLE_ALREADY_SELECTED: "已经选择过角色",
    CONDUCTOR_USES_ENGINE: "列车长固定在车头选位",
    CONDUCTOR_ALREADY_SELECTED: "本局已经有列车长",
    SORCERER_ALREADY_SELECTED: "本局已经有咒术师",
    FOG_VISION_UNAVAILABLE: "当前无法使用雾视",
    FOG_DECISION_PENDING: "正在等待咒术师决定",
    NO_FOG_DECISION: "当前没有雾视需要响应",
    NOT_A_SORCERER: "只有咒术师可以响应雾视",
    FOG_DECISION_ALREADY_MADE: "已经完成雾视响应",
    INVISIBILITY_UNAVAILABLE: "隐身衣已经使用过",
    BOOK_NOT_HELD: "没有持有古籍",
    INVALID_BOOK_DIRECTION: "投书方向无效",
    NOT_ARCHAEOLOGIST: "只有考古学家可以阅读",
    INVALID_READING_TARGET: "阅读目标无效",
    NO_BOOK_READS: "古籍阅读次数已用完",
    BOT_ONLY_REQUIRED: "只有场上仅剩机器人时才能结束对局",
    INVALID_CHAT: "聊天内容不能为空且不能超过120字",
  };
  return { ok: false, code, message: messages[code] ?? "操作失败" };
}

function createRoomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

function uniqueColors(members: MemberState[]): string {
  const used = new Set(members.map((member) => member.color));
  return MEMBER_COLORS.find((color) => !used.has(color)) ?? MEMBER_COLORS[members.length % MEMBER_COLORS.length]!;
}

function memberToPublic(member: MemberState, hostUserId: string, game: GameState | null): PublicMember {
  const participant = game
    ? Object.values(game.participants).find((candidate) => candidate.userId === member.userId)
    : undefined;
  return {
    userId: member.userId,
    participantId: participant?.id ?? null,
    nickname: member.nickname,
    color: member.color,
    kind: member.kind,
    controlState: member.control,
    roleId: participant?.roleId || null,
    isBot: member.isBot,
    botDifficulty: member.botDifficulty,
    isGoldenBot: member.isGoldenBot,
    ready: member.ready,
    isHost: member.userId === hostUserId,
    joinOrder: member.joinOrder,
  };
}

function participantToResult(participant: ParticipantState): PlayerResult {
  return {
    participantId: participant.id,
    userId: participant.userId,
    nickname: participant.nickname,
    color: participant.color,
    roleId: participant.roleId || ROLE_UNLUCKY.id,
    isBot: participant.isBot,
    finalRank: participant.finalRank ?? 99,
    survivedRounds: participant.survivedRounds,
    moveCount: participant.moveCount,
    skillUseCount: participant.skillUseCount,
    killCount: participant.killCount,
    waterCount: participant.waterCount,
    deathRound: participant.deathRound,
    deathReason: participant.deathReason,
    initialPosition: participant.initialPosition,
    finalPosition: participant.finalPosition,
  };
}

function buildFogVisionView(
  game: GameState,
  participant: ParticipantState,
): {
  visibleSectionIds: string[];
  revealedPositions: Position[];
  sectionHints: FogSectionHint[];
} {
  const visibleSectionIds = participant.position
    ? getVisibleSectionIds(game.map, participant.position)
    : game.map.sections.map((section) => section.id);
  const active = game.fogViews[participant.id];
  if (!active) {
    return { visibleSectionIds, revealedPositions: [], sectionHints: [] };
  }

  const visible = new Set(visibleSectionIds);
  const sectionOrder = new Map(
    game.map.sections.map((section, index) => [section.id, index]),
  );
  const visibleStart = sectionOrder.get(visibleSectionIds[0] ?? "") ?? 0;
  const visibleEnd =
    sectionOrder.get(visibleSectionIds[visibleSectionIds.length - 1] ?? "") ??
    game.map.sections.length - 1;
  const revealedPositions: Position[] = [];
  const hints = new Map<string, FogSectionHint>();

  for (const position of active.positions) {
    const section = getSectionAt(game.map, position);
    if (!section) continue;
    if (visible.has(section.id)) {
      revealedPositions.push({ ...position });
      continue;
    }
    const order = sectionOrder.get(section.id) ?? 0;
    const hint = hints.get(section.id) ?? {
      direction: order < visibleStart ? ("above" as const) : ("below" as const),
      sectionId: section.id,
      sectionLabel: section.label,
      count: 0,
    };
    hint.count += 1;
    hints.set(section.id, hint);
  }

  return {
    visibleSectionIds,
    revealedPositions,
    sectionHints: [...hints.values()].sort(
      (left, right) =>
        (sectionOrder.get(left.sectionId) ?? 0) -
        (sectionOrder.get(right.sectionId) ?? 0),
    ),
  };
}

function canEndBotOnlyGame(room: RoomState, userId: string): boolean {
  if (room.phase !== "playing" || room.hostUserId !== userId || !room.game) {
    return false;
  }
  const alive = aliveParticipants(room.game);
  return alive.length > 0 && alive.every((participant) => participant.isBot);
}

function normalizeRoomState(room: RoomState): RoomState {
  // 兼容旧快照：服务重启时补齐后来新增的字段，避免旧房间无法恢复。
  room.mapId ??= DEFAULT_MAP_ID;
  for (const member of room.members) {
    member.isBot ??= false;
    member.botDifficulty ??= null;
    member.isGoldenBot ??= false;
  }
  if (!room.game) return room;
  room.game.mapId ??= room.mapId;
  room.game.lockedDoors ??= {};
  room.game.paintTiles ??= [];
  room.game.paintTileMeta ??= {};
  for (const tile of Object.values(room.game.paintTileMeta)) {
    tile.source ??= "spread";
  }
  room.game.gunshotSignals ??= [];
  room.game.hookSignals ??= [];
  room.game.books ??= {};
  room.game.readingMarks ??= {};
  room.game.pendingFogVision ??= null;
  room.game.fogViews ??= {};
  const legacyFog = room.game as GameState & {
    activeFogVision?: ActiveFogVision | null;
  };
  if (Array.isArray(legacyFog.activeFogVision?.positions)) {
    room.game.fogViews[legacyFog.activeFogVision.casterParticipantId] =
      legacyFog.activeFogVision;
  }
  legacyFog.activeFogVision = null;
  room.game.conductorActionCounts ??= {};
  for (const participant of Object.values(room.game.participants)) {
    participant.isBot ??= false;
    participant.botDifficulty ??= null;
    participant.isGoldenBot ??= false;
    participant.ammo ??= ["hunter", "thief"].includes(participant.roleId) ? 1 : 0;
    participant.paintUsesRemaining ??= participant.roleId === "painter" ? 3 : 0;
    participant.paintSpreadRoundsRemaining ??= 0;
    participant.lockUsesRemaining ??= participant.roleId === "conductor" ? 2 : 0;
    participant.lastLockRound ??= null;
    participant.fogVisionUsesRemaining ??= participant.roleId === "corpse" ? 0 : 3;
    participant.lastFogVisionRound ??= null;
    participant.hasBackpack ??= participant.roleId === "traveler";
    participant.prophecyBallAvailable ??= participant.roleId === "sorcerer";
    participant.invisibilityCloakAvailable ??= participant.roleId === "sorcerer";
    participant.bookIds ??= [];
  }
  return room;
}

export class RoomService {
  private readonly rooms = new Map<string, RoomState>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly userRoomLocks = new Map<string, Promise<unknown>>();
  private changeHandler: ChangeHandler;
  private botController: BotController | null = null;

  constructor(
    private readonly settings: RoomSettings,
    onChange: ChangeHandler,
  ) {
    this.changeHandler = onChange;
  }

  setChangeHandler(handler: ChangeHandler): void {
    this.changeHandler = handler;
  }

  setBotController(controller: BotController): void {
    this.botController = controller;
  }

  async initialize(): Promise<void> {
    const snapshots = await loadLatestRoomSnapshots();
    for (const snapshot of snapshots) {
      const room = normalizeRoomState(snapshot.state as RoomState);
      const hasPlayers = room.members.some(
        (member) =>
          member.kind === "player" && member.control !== "left" && !member.isBot,
      );
      if (room.phase === "closed" || !hasPlayers) {
        await deleteRoomData(room.id);
        continue;
      }
      const now = new Date().toISOString();
      for (const member of room.members) {
        if (member.control === "active" && !member.isBot) {
          member.control = "disconnected";
          member.disconnectedAt = now;
        }
      }
      this.rooms.set(room.id, room);
      await this.persistSnapshot(room);
      await this.armTimers(room);
    }
  }

  getLoadedRooms(): RoomState[] {
    return [...this.rooms.values()];
  }

  async getRoomByCode(code: string): Promise<RoomState | null> {
    const normalized = code.trim().toUpperCase();
    const loaded = [...this.rooms.values()].find((room) => room.code === normalized);
    if (loaded) return loaded;

    const record = await findRoomByCode(normalized);
    if (!record) return null;
    const snapshot = await findLatestSnapshotByRoomId(record.id);
    if (!snapshot) return null;
    const room = normalizeRoomState(snapshot.state as RoomState);
    this.rooms.set(room.id, room);
    await this.armTimers(room);
    return room;
  }

  getRoomById(roomId: string): RoomState | null {
    return this.rooms.get(roomId) ?? null;
  }

  async createRoom(
    user: RoomUser,
    mapId: MapId = DEFAULT_MAP_ID,
  ): Promise<RoomState> {
    return this.withUserRoomLock(user.id, () => this.createRoomUnlocked(user, mapId));
  }

  private async createRoomUnlocked(
    user: RoomUser,
    mapId: MapId,
  ): Promise<RoomState> {
    const selectedMap = MAP_REGISTRY[mapId];
    if (!selectedMap?.available) throw new Error("MAP_UNAVAILABLE");
    await this.leaveOtherRoomsForUser(user.id);
    let code = createRoomCode();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await findRoomByCode(code))) break;
      code = createRoomCode();
    }
    const now = new Date().toISOString();
    const host: MemberState = {
      userId: user.id,
      nickname: user.nickname,
      color: MEMBER_COLORS[0]!,
      kind: "player",
      control: "active",
      ready: true,
      joinOrder: 0,
      disconnectedAt: null,
      isBot: false,
      botDifficulty: null,
      isGoldenBot: false,
    };
    const room: RoomState = {
      version: 1,
      id: randomUUID(),
      code,
      mapId,
      hostUserId: user.id,
      phase: "lobby",
      settings: this.settings,
      initialPlayerCount: 0,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      closedAt: null,
      seq: 0,
      members: [host],
      messages: [],
      game: null,
      processedCommands: {},
    };
    this.rooms.set(room.id, room);
    await this.persistSnapshot(room);
    return room;
  }

  async joinRoom(room: RoomState, user: RoomUser): Promise<{ kind: "player" | "spectator"; room: RoomState }> {
    return this.withUserRoomLock(user.id, () => this.joinRoomUnlocked(room, user));
  }

  private async joinRoomUnlocked(
    room: RoomState,
    user: RoomUser,
  ): Promise<{ kind: "player" | "spectator"; room: RoomState }> {
    if (room.phase === "closed") throw new Error("ROOM_CLOSED");
    await this.leaveOtherRoomsForUser(user.id, room.id);
    const existing = room.members.find((member) => member.userId === user.id);
    if (existing && existing.control !== "left") {
      existing.control = existing.control === "disconnected" ? "active" : existing.control;
      existing.disconnectedAt = null;
      await this.persistSnapshot(room);
      await this.armTimers(room);
      return { kind: existing.kind, room };
    }
    if (existing?.control === "left") {
      room.members = room.members.filter((member) => member.userId !== user.id);
    }

    const playerCount = room.members.filter(
      (member) => member.kind === "player" && member.control !== "left",
    ).length;
    const botSeat =
      room.phase === "lobby" && playerCount >= 8
        ? room.members
            .filter(
              (member) =>
                member.kind === "player" &&
                member.control !== "left" &&
                member.isBot,
            )
            .sort((left, right) => left.joinOrder - right.joinOrder)[0]
        : undefined;
    if (botSeat) {
      botSeat.userId = user.id;
      botSeat.nickname = user.nickname;
      botSeat.control = "active";
      botSeat.ready = false;
      botSeat.disconnectedAt = null;
      botSeat.isBot = false;
      botSeat.botDifficulty = null;
      botSeat.isGoldenBot = false;
      await this.persistSnapshot(room);
      await this.changeHandler(room, { events: [], actions: [] });
      return { kind: "player", room };
    }
    const spectatorCount = room.members.filter(
      (member) => member.kind === "spectator" && member.control !== "left",
    ).length;
    const kind = room.phase === "lobby" && playerCount < 8 ? "player" : "spectator";
    if (kind === "spectator" && spectatorCount >= room.settings.maxSpectators) {
      throw new Error("ROOM_FULL");
    }

    const nextJoinOrder =
      room.members.reduce((maximum, member) => Math.max(maximum, member.joinOrder), -1) + 1;
    const nextMember: MemberState = {
      userId: user.id,
      nickname: user.nickname,
      color: uniqueColors(room.members),
      kind,
      control: "active",
      ready: false,
      joinOrder: nextJoinOrder,
      disconnectedAt: null,
      isBot: false,
      botDifficulty: null,
      isGoldenBot: false,
    };
    if (existing) {
      Object.assign(existing, nextMember);
    } else {
      room.members.push(nextMember);
    }
    await this.persistSnapshot(room);
    await this.changeHandler(room, { events: [], actions: [] });
    return { kind, room };
  }

  async executeCommand(
    room: RoomState,
    userId: string,
    commandId: string,
    handler: (member: MemberState) => Promise<EngineResult | void> | EngineResult | void,
  ): Promise<CommandAck> {
    // commandId 用于 Socket 重试去重，同一命令最多结算一次。
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.control === "left") return commandError(new Error("NOT_A_MEMBER"));
    const prior = room.processedCommands[commandId];
    if (prior) return { ok: true, roomSeq: prior.roomSeq };

    try {
      const result = (await handler(member)) ?? { events: [], actions: [] };
      await this.commit(room, result, commandId);
      await this.cleanupEmptyRoom(room);
      return { ok: true, roomSeq: room.seq };
    } catch (error) {
      return commandError(error);
    }
  }

  async ready(room: RoomState, userId: string, ready: boolean): Promise<EngineResult> {
    if (room.phase !== "lobby") throw new Error("WRONG_PHASE");
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.kind !== "player" || member.control === "left") {
      throw new Error("NOT_A_MEMBER");
    }
    member.ready = ready;
    return { events: [], actions: [] };
  }

  async addBot(
    room: RoomState,
    userId: string,
    difficulty: BotDifficulty,
  ): Promise<EngineResult> {
    if (room.phase !== "lobby") throw new Error("WRONG_PHASE");
    if (room.hostUserId !== userId) throw new Error("NOT_HOST");
    const players = room.members.filter(
      (member) => member.kind === "player" && member.control !== "left",
    );
    if (players.length >= 8) throw new Error("PLAYER_COUNT");
    if (difficulty !== "pure_bot" && difficulty !== "standard") {
      throw new Error("INVALID_BOT_DIFFICULTY");
    }
    const usedNames = new Set(
      room.members.filter((member) => member.isBot).map((member) => member.nickname),
    );
    const nickname = chooseBotName(usedNames);
    const joinOrder =
      room.members.reduce((maximum, member) => Math.max(maximum, member.joinOrder), -1) + 1;
    room.members.push({
      userId: randomUUID(),
      nickname,
      color: uniqueColors(room.members),
      kind: "player",
      control: "active",
      ready: true,
      joinOrder,
      disconnectedAt: null,
      isBot: true,
      botDifficulty: difficulty,
      isGoldenBot: nickname === GOLDEN_BOT_NAME,
    });
    return { events: [], actions: [] };
  }

  async removeBot(room: RoomState, userId: string, botUserId: string): Promise<EngineResult> {
    if (room.phase !== "lobby") throw new Error("WRONG_PHASE");
    if (room.hostUserId !== userId) throw new Error("NOT_HOST");
    const target = room.members.find(
      (member) => member.userId === botUserId && member.isBot,
    );
    if (!target) throw new Error("NOT_A_BOT");
    room.members = room.members.filter((member) => member.userId !== botUserId);
    return { events: [], actions: [] };
  }

  async startRoom(room: RoomState, userId: string, now = new Date()): Promise<EngineResult> {
    if (room.phase !== "lobby") throw new Error("WRONG_PHASE");
    if (room.hostUserId !== userId) throw new Error("NOT_HOST");
    const players = roomPlayers(room);
    if (players.length < 2 || players.length > 8) throw new Error("PLAYER_COUNT");
    if (
      players.some(
        (member) =>
          member.userId !== userId &&
          (!member.ready || member.control !== "active"),
      )
    ) {
      throw new Error(
        players.some((member) => member.userId !== userId && !member.ready)
          ? "PLAYER_NOT_READY"
          : "PLAYER_OFFLINE",
      );
    }
    room.initialPlayerCount = players.length;
    room.game = createGame(room.id, players, now, room.mapId);
    room.startedAt = now.toISOString();
    const result = startRoleSelection(room, now);
    return result;
  }

  async selectRole(room: RoomState, userId: string, roleId: string): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return chooseRole(room, userId, roleId);
  }

  async chooseSection(room: RoomState, userId: string, sectionId: string): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return choosePlacementSection(room, userId, sectionId);
  }

  async chooseCell(room: RoomState, userId: string, position: Position): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return choosePlacementCell(room, userId, position);
  }

  async move(room: RoomState, userId: string, direction: Parameters<typeof applyMove>[2]): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return applyMove(room, userId, direction);
  }

  async useSkill(
    room: RoomState,
    userId: string,
    skillId: Parameters<typeof useSkill>[2],
    target: Parameters<typeof useSkill>[3],
  ): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return useSkill(room, userId, skillId, target);
  }

  async useFogVision(room: RoomState, userId: string): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return useFogVision(room, userId);
  }

  async respondToFogVision(
    room: RoomState,
    userId: string,
    useProphecyBall: boolean,
    useInvisibility: boolean,
  ): Promise<EngineResult> {
    return respondToFogVision(room, userId, useProphecyBall, useInvisibility);
  }

  async throwBook(
    room: RoomState,
    userId: string,
    direction: Parameters<typeof throwBook>[2],
  ): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return throwBook(room, userId, direction);
  }

  async readBook(
    room: RoomState,
    userId: string,
    targetParticipantId: string,
  ): Promise<EngineResult> {
    this.assertActivePlayer(room, userId, true);
    return readBook(room, userId, targetParticipantId);
  }

  async phrase(room: RoomState, userId: string, phraseId: string): Promise<EngineResult> {
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.kind === "spectator") throw new Error("SPECTATOR_READ_ONLY");
    const participant = room.game ? findParticipantByUser(room.game, userId) : null;
    if (participant && !participant.alive) throw new Error("DEAD_READ_ONLY");
    const phrase = PHRASES.find((candidate) => candidate.id === phraseId);
    if (!phrase) throw new Error("UNKNOWN_PHRASE");
    const last = [...room.messages]
      .reverse()
      .find((message) => message.userId === userId);
    if (last && Date.now() - new Date(last.createdAt).getTime() < 2_000) {
      throw new Error("PHRASE_RATE_LIMIT");
    }

    const message = {
      id: randomUUID(),
      userId,
      nickname: member.nickname,
      phraseId: phrase.id,
      text: phrase.text,
      createdAt: new Date().toISOString(),
    };
    room.messages.push(message);
    if (room.messages.length > 50) room.messages.splice(0, room.messages.length - 50);
    await saveRoomMessage({
      id: message.id,
      roomId: room.id,
      userId,
      phraseId,
      text: phrase.text,
      createdAt: new Date(message.createdAt),
    });
    return {
      events: [
        {
          type: "phrase",
          round: room.game?.currentRound ?? null,
          actorParticipantId: participant?.id ?? null,
          payload: message,
          createdAt: message.createdAt,
        },
      ],
      actions: [],
    };
  }

  async chat(room: RoomState, userId: string, text: string): Promise<EngineResult> {
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.kind === "spectator") throw new Error("SPECTATOR_READ_ONLY");
    const participant = room.game ? findParticipantByUser(room.game, userId) : null;
    if (participant && !participant.alive) throw new Error("DEAD_READ_ONLY");
    const content = text.trim();
    if (!content || content.length > 120) throw new Error("INVALID_CHAT");
    const last = [...room.messages]
      .reverse()
      .find((message) => message.userId === userId);
    if (last && Date.now() - new Date(last.createdAt).getTime() < 800) {
      throw new Error("PHRASE_RATE_LIMIT");
    }
    const message = {
      id: randomUUID(),
      userId,
      nickname: member.nickname,
      phraseId: "chat",
      text: content,
      createdAt: new Date().toISOString(),
    };
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);
    await saveRoomMessage({
      id: message.id,
      roomId: room.id,
      userId,
      phraseId: "chat",
      text: content,
      createdAt: new Date(message.createdAt),
    });
    return {
      events: [
        {
          type: "chat",
          round: room.game?.currentRound ?? null,
          actorParticipantId: participant?.id ?? null,
          payload: message,
          createdAt: message.createdAt,
        },
      ],
      actions: [],
    };
  }

  async rematch(room: RoomState, userId: string): Promise<EngineResult> {
    if (room.phase !== "finished") throw new Error("WRONG_PHASE");
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.kind !== "player" || member.control === "left") {
      throw new Error("NOT_A_MEMBER");
    }
    await deleteGameHistory(room.id);
    room.phase = "lobby";
    room.game = null;
    room.startedAt = null;
    room.finishedAt = null;
    room.closedAt = null;
    room.initialPlayerCount = 0;
    room.messages = [];
    for (const player of room.members) {
      if (player.kind !== "player" || player.control === "left") continue;
      if (player.control === "dead") player.control = "active";
      player.ready = player.isBot;
    }
    return {
      events: [
        {
          type: "phase_changed",
          round: null,
          actorParticipantId: null,
          payload: { phase: "lobby" },
          createdAt: new Date().toISOString(),
        },
      ],
      actions: [],
    };
  }

  async endBotGame(room: RoomState, userId: string): Promise<EngineResult> {
    return finishBotOnlyGame(room, userId);
  }

  async leaveRoom(room: RoomState, userId: string): Promise<EngineResult> {
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.control === "left") return { events: [], actions: [] };

    let result: EngineResult = { events: [], actions: [] };
    if (
      room.game &&
      ["role_select", "placement", "playing"].includes(room.phase)
    ) {
      const participant = findParticipantByUser(room.game, userId);
      if (participant?.alive) {
        result = killParticipant(room, participant.id, "voluntary_exit");
      }
    }
    member.control = "left";
    member.ready = false;
    if (room.hostUserId === userId) this.transferHost(room);
    if (
      !room.members.some(
        (candidate) =>
          candidate.kind === "player" &&
          candidate.control !== "left" &&
          !candidate.isBot,
      )
    ) {
      this.closeRoom(room);
    }
    this.clearMemberTimer(room.id, userId);
    return result;
  }

  async markDisconnected(room: RoomState, userId: string): Promise<EngineResult> {
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.control === "left") return { events: [], actions: [] };
    if (member.isBot) return { events: [], actions: [] };
    if (member.control !== "disconnected") {
      if (room.phase === "finished") {
        member.control = "left";
        member.disconnectedAt = null;
        member.ready = false;
      } else {
        member.control = "disconnected";
        member.disconnectedAt = new Date().toISOString();
      }
    }
    return { events: [], actions: [] };
  }

  async markConnected(room: RoomState, userId: string): Promise<EngineResult> {
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.control === "left") return { events: [], actions: [] };
    if (member.isBot) return { events: [], actions: [] };
    if (member.control === "disconnected") {
      member.control = "active";
      member.disconnectedAt = null;
      this.clearMemberTimer(room.id, userId);
    }
    return { events: [], actions: [] };
  }

  buildSnapshot(room: RoomState, userId: string): RoomSnapshot {
    // 关键防作弊投影：
    // 存活玩家只拿到自己的位置；死亡玩家和观战者才拿全图；
    // 雾视结果只发给正在生效的雾视使用者本人。
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.control === "left") throw new Error("NOT_A_MEMBER");
    const game = room.game;
    const participant = game ? findParticipantByUser(game, userId) : null;
    const spectatorView =
      member.kind === "spectator" ||
      room.phase === "finished" ||
      (participant ? !participant.alive : false);
    const currentActor = game ? currentTurnParticipant(game) : null;
    const placement = game
      ? {
          occupiedSectionIds: Object.values(game.participants)
            .filter((candidate) => candidate.alive && candidate.placedSectionId)
            .map((candidate) => candidate.placedSectionId!),
          selectedSectionId:
            participant?.placedSectionId ??
            (participant?.roleId === ROLE_CONDUCTOR.id &&
            game.phase === "placement" &&
            !participant.placementComplete
              ? game.map.sections.find((section) => section.type === "engine")?.id ?? null
              : null),
          selectedPosition:
            participant?.placementComplete && participant.position
              ? { ...participant.position }
              : null,
        }
      : null;

    const players = game
      ? Object.values(game.participants).map((candidate) => {
          const candidateMember = room.members.find(
            (roomMember) => roomMember.userId === candidate.userId,
          );
          return {
            participantId: candidate.id,
            nickname: candidate.nickname,
            color: candidate.color,
            position: candidate.position ?? { x: -1, y: -1 },
            alive: candidate.alive,
            roleId: candidate.roleId || ROLE_UNLUCKY.id,
            isBot: candidate.isBot,
            botDifficulty: candidate.botDifficulty,
            online: candidateMember?.control === "active",
            waterCountdown: candidate.waterCountdown,
            paintSpreadRoundsRemaining: candidate.paintSpreadRoundsRemaining,
          };
        })
      : undefined;
    const fogView =
      game && participant && participant.alive
        ? buildFogVisionView(game, participant)
        : {
            visibleSectionIds: game?.map.sections.map((section) => section.id) ?? [],
            revealedPositions: [],
            sectionHints: [],
          };
    const self = participant
      ? {
          participantId: participant.id,
          position: participant.position ? { ...participant.position } : null,
          roleId: participant.roleId || ROLE_UNLUCKY.id,
          isBot: participant.isBot,
          botDifficulty: participant.botDifficulty,
          waterCountdown: participant.waterCountdown,
          legalMoves:
            game?.phase === "playing" &&
            participant.alive &&
            currentActor?.id === participant.id
              ? legalMovementDirections(game, participant)
              : [],
          isCurrentTurn: currentActor?.id === participant.id,
          visibleSectionIds: fogView.visibleSectionIds,
          skill: {
            skillIds:
              ROLE_REGISTRY[participant.roleId as keyof typeof ROLE_REGISTRY]?.skillIds ?? [],
            ammo: participant.ammo,
            paintUsesRemaining: participant.paintUsesRemaining,
            paintSpreadRoundsRemaining: participant.paintSpreadRoundsRemaining,
            lockUsesRemaining: participant.lockUsesRemaining,
            lockUsedThisRound: participant.lastLockRound === game?.currentRound,
            canUseSkill:
              Boolean(
                game?.phase === "playing" &&
                  participant.alive &&
                  currentActor?.id === participant.id,
              ) && !skillUnavailableReason(game!, participant),
            unavailableReason: skillUnavailableReason(game!, participant),
          },
          fogVision: {
            usesRemaining: participant.fogVisionUsesRemaining,
            usedThisRound: participant.lastFogVisionRound === game?.currentRound,
            canUse:
              Boolean(
                game?.phase === "playing" &&
                  participant.alive &&
                  currentActor?.id === participant.id,
            ) && !fogVisionUnavailableReason(game!, participant),
            unavailableReason: fogVisionUnavailableReason(game!, participant),
            pending: Boolean(game?.pendingFogVision),
            canRespond:
              game?.pendingFogVision?.sorcererParticipantId === participant.id &&
              !game.pendingFogVision.responded,
            responded:
              game?.pendingFogVision?.sorcererParticipantId === participant.id
                ? game.pendingFogVision.responded
                : false,
            prophecyBallAvailable: participant.prophecyBallAvailable,
            invisibilityCloakAvailable: participant.invisibilityCloakAvailable,
            revealedPositions: fogView.revealedPositions,
            sectionHints: fogView.sectionHints,
          },
          items: {
            hasBackpack: participant.hasBackpack,
            prophecyBallAvailable: participant.prophecyBallAvailable,
            invisibilityCloakAvailable: participant.invisibilityCloakAvailable,
            bookIds: participant.bookIds,
            readUsesRemaining: participant.bookIds.reduce(
              (total, bookId) => total + (game?.books[bookId]?.readsRemaining ?? 0),
              0,
            ),
            bookMarkers: Object.values(game?.books ?? {}).flatMap((book) =>
              book.throwerMarkers
                .filter(
                  (marker) =>
                    marker.active && marker.throwerParticipantId === participant.id,
                )
                .map((marker) => ({
                  id: marker.id,
                  bookId: book.id,
                  position: marker.position,
                  title: "古籍落点",
                })),
            ),
            readingMark: (() => {
              const mark = game?.readingMarks[participant.id];
              if (!mark) return null;
              const target = game?.participants[mark.targetParticipantId];
              if (!target) return null;
              return {
                targetParticipantId: target.id,
                nickname: target.nickname,
                roleId: target.roleId,
                position: mark.position,
              };
            })(),
          },
        }
      : undefined;
    const leaderboard = game?.phase === "finished" ? getLeaderboard(game) : undefined;
    const fog = game?.pendingFogVision
      ? {
          status: "pending" as const,
          deadlineAt: game.pendingFogVision.deadlineAt,
          casterParticipantId: game.pendingFogVision.casterParticipantId,
          canRespond:
            game.pendingFogVision.sorcererParticipantId === participant?.id &&
            !game.pendingFogVision.responded,
          responded: game.pendingFogVision.responded,
        }
      : null;

    return {
      roomId: room.id,
      roomCode: room.code,
      phase: room.phase,
      hostUserId: room.hostUserId,
      members: room.members
        .filter((candidate) => candidate.control !== "left")
        .sort((left, right) => left.joinOrder - right.joinOrder)
        .map((candidate) => memberToPublic(candidate, room.hostUserId, game)),
      settings: room.settings,
      initialPlayerCount: game
        ? Object.keys(game.participants).length
        : room.initialPlayerCount || null,
      currentRound: game?.currentRound ?? 0,
      completedRounds: game?.completedRounds ?? 0,
      aliveCount: game
        ? aliveParticipants(game).length
        : room.members.filter((candidate) => candidate.kind === "player" && candidate.control !== "left")
            .length,
      turnOrder: game
        ? game.participantOrder
            .map((participantId) => game.participants[participantId])
            .filter((candidate): candidate is ParticipantState => Boolean(candidate))
            .map((candidate) => ({
              participantId: candidate.id,
              nickname: candidate.nickname,
            }))
        : [],
      mapId: room.mapId,
      mapName: MAP_REGISTRY[room.mapId]?.name ?? "暂无",
      maps: Object.values(MAP_REGISTRY).sort(
        (left, right) => left.sortOrder - right.sortOrder,
      ),
      roles: Object.values(ROLE_REGISTRY).sort(
        (left, right) => left.sortOrder - right.sortOrder,
      ),
      selectedRoleId: participant?.roleId || null,
      placement,
      map: game?.map ?? null,
      lockedDoors: Object.values(game?.lockedDoors ?? {}),
      paintTiles: game?.paintTiles ?? [],
      gunshotSignals: game?.gunshotSignals ?? [],
      hookSignals: game?.hookSignals ?? [],
      fog,
      spectatorMap: spectatorView,
      ...(spectatorView && players ? { players } : {}),
      ...(self ? { self } : {}),
      winnerParticipantIds: game?.winnerParticipantIds ?? [],
      deadlineAt: game?.deadlineAt ?? null,
      currentActor: currentActor
        ? { participantId: currentActor.id, nickname: currentActor.nickname }
        : null,
      messages: room.messages.slice(-50),
      ...(leaderboard ? { leaderboard } : {}),
      canEndBotOnlyGame: canEndBotOnlyGame(room, userId),
    };
  }

  private assertActivePlayer(room: RoomState, userId: string, requireGame: boolean): void {
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.kind !== "player") throw new Error("SPECTATOR_READ_ONLY");
    if (member.control !== "active") throw new Error("PLAYER_NOT_ALIVE");
    if (requireGame && !room.game) throw new Error("WRONG_PHASE");
    const participant = room.game ? findParticipantByUser(room.game, userId) : null;
    if (participant && !participant.alive) throw new Error("DEAD_READ_ONLY");
  }

  private async commit(
    room: RoomState,
    result: EngineResult,
    commandId: string,
  ): Promise<void> {
    // 先写行动日志、事件和状态快照，再更新内存并广播。
    // 崩溃发生在广播前也不会丢失已提交的规则结果。
    const game = room.game;
    for (const action of result.actions) {
      if (!game) continue;
      if (!game.actions.some((existing) => existing.id === action.id)) {
        action.seq = game.actions.length + 1;
        game.actions.push(action);
      }
      await saveGameAction({ ...action, gameId: game.id, roomId: room.id });
    }

    for (const event of result.events) {
      if (game) {
        const replayEvent = {
          id: randomUUID(),
          seq: ++game.seq,
          round: event.round,
          type: event.type,
          actorParticipantId: event.actorParticipantId,
          payload: event.payload,
          createdAt: event.createdAt,
        };
        game.events.push(replayEvent);
        await saveGameEvent({ ...replayEvent, gameId: game.id, roomId: room.id });
      }
    }

    if (game) {
      room.phase = game.phase;
      for (const participant of Object.values(game.participants)) {
        const member = room.members.find((candidate) => candidate.userId === participant.userId);
        if (member && member.control !== "left") {
          member.control = participant.alive ? member.control : "dead";
          if (!participant.alive) member.ready = false;
        }
      }
      if (game.phase === "finished") {
        const participants = Object.values(game.participants);
        for (const participant of participants) {
          await saveGameParticipant({
            ...participantToResult(participant),
            gameId: game.id,
            roomId: room.id,
          });
        }
        const playerCount = participants.length;
        await savePlayerGameResults(
          participants
            .filter((participant) => !participant.isBot && participant.finalRank)
            .map((participant) => {
              const finalRank = participant.finalRank ?? playerCount;
              return {
                gameId: game.id,
                userId: participant.userId,
                roleId: participant.roleId || ROLE_UNLUCKY.id,
                finalRank,
                playerCount,
                rating:
                  (10 / playerCount) * (playerCount - finalRank + 1),
                killCount: participant.killCount,
                deathCount: participant.alive ? 0 : 1,
                won: finalRank === 1,
                finishedAt: new Date(game.finishedAt ?? new Date().toISOString()),
              };
            }),
        );
      }
    }

    room.seq += 1;
    room.processedCommands[commandId] = { at: new Date().toISOString(), roomSeq: room.seq };
    const entries = Object.entries(room.processedCommands);
    if (entries.length > 300) {
      room.processedCommands = Object.fromEntries(entries.slice(-200));
    }
    await this.persistSnapshot(room);
    await this.armTimers(room);
    await this.changeHandler(room, result);
    this.botController?.schedule(room);
  }

  private async withUserRoomLock<T>(
    userId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.userRoomLocks.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.userRoomLocks.set(userId, current);
    try {
      return await current;
    } finally {
      if (this.userRoomLocks.get(userId) === current) {
        this.userRoomLocks.delete(userId);
      }
    }
  }

  private async leaveOtherRoomsForUser(
    userId: string,
    keepRoomId?: string,
  ): Promise<void> {
    for (const room of [...this.rooms.values()]) {
      if (room.id === keepRoomId) continue;
      const member = room.members.find((candidate) => candidate.userId === userId);
      if (!member || member.control === "left") continue;
      const result = await this.leaveRoom(room, userId);
      await this.commit(
        room,
        result,
        `auto-leave:${room.id}:${userId}:${randomUUID()}`,
      );
      await this.cleanupEmptyRoom(room);
    }
  }

  private async persistSnapshot(room: RoomState): Promise<void> {
    await saveRoomSnapshot({
      roomId: room.id,
      gameId: room.game?.id ?? null,
      seq: room.seq,
      state: room,
      code: room.code,
      hostUserId: room.hostUserId,
      mapId: room.mapId,
      status: room.phase,
      initialPlayerCount: room.initialPlayerCount,
      settings: room.settings,
      startedAt: room.startedAt ? new Date(room.startedAt) : null,
      finishedAt: room.finishedAt ? new Date(room.finishedAt) : null,
      closedAt: room.closedAt ? new Date(room.closedAt) : null,
      createdAt: new Date(room.createdAt),
    });
  }

  private transferHost(room: RoomState): void {
    const candidates = [
      ...room.members.filter(
        (member) =>
          member.control !== "left" &&
          !member.isBot &&
          member.kind === "player" &&
          (!room.game || findParticipantByUser(room.game, member.userId)?.alive),
      ),
      ...room.members.filter(
        (member) =>
          member.control !== "left" && member.kind === "player" && !member.isBot,
      ),
      ...room.members.filter((member) => member.control !== "left" && !member.isBot),
    ].sort((left, right) => left.joinOrder - right.joinOrder);
    const next = candidates[0];
    if (next) room.hostUserId = next.userId;
    else this.closeRoom(room);
  }

  private closeRoom(room: RoomState): void {
    if (room.phase === "finished") return;
    room.phase = "closed";
    room.closedAt = new Date().toISOString();
    this.clearRoomTimers(room.id);
  }

  private async cleanupEmptyRoom(room: RoomState): Promise<void> {
    // 最后一个玩家身份成员离开或超时后，整间房和全部对局数据立即删除。
    const hasPlayers = room.members.some(
      (member) =>
        member.kind === "player" && member.control !== "left" && !member.isBot,
    );
    if (hasPlayers) return;
    this.clearRoomTimers(room.id);
    this.botController?.clear(room.id);
    this.rooms.delete(room.id);
    await deleteRoomData(room.id);
  }

  private async armTimers(room: RoomState): Promise<void> {
    // 截止时间使用绝对时间；重连或重启不会重新获得完整倒计时。
    this.clearRoomTimers(room.id);
    if (room.phase === "closed") return;
    if (room.phase !== "finished" && room.game?.deadlineAt) {
      const delay = Math.max(0, new Date(room.game.deadlineAt).getTime() - Date.now());
      this.timers.set(
        `${room.id}:turn`,
        setTimeout(() => {
          void this.handleTurnTimeout(room.id);
        }, delay),
      );
    }
    for (const member of room.members) {
      if (member.control !== "disconnected" || !member.disconnectedAt) continue;
      const delay = Math.max(
        0,
        new Date(member.disconnectedAt).getTime() +
          room.settings.reconnectGraceMs -
          Date.now(),
      );
      this.timers.set(
        `${room.id}:disconnect:${member.userId}`,
        setTimeout(() => {
          void this.handleDisconnectTimeout(room.id, member.userId);
        }, delay),
      );
    }
  }

  private clearMemberTimer(roomId: string, userId: string): void {
    const key = `${roomId}:disconnect:${userId}`;
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  private clearRoomTimers(roomId: string): void {
    for (const [key, timer] of this.timers) {
      if (!key.startsWith(`${roomId}:`)) continue;
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private async handleTurnTimeout(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room || !room.game?.deadlineAt) return;
    if (new Date(room.game.deadlineAt).getTime() > Date.now() + 10) return;
    const result = applyTurnTimeout(room);
    await this.commit(room, result, `timeout:${room.seq}`);
  }

  private async handleDisconnectTimeout(roomId: string, userId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const member = room.members.find((candidate) => candidate.userId === userId);
    if (!member || member.control !== "disconnected") return;

    if (["role_select", "placement", "playing"].includes(room.phase) && room.game) {
      const participant = findParticipantByUser(room.game, userId);
      if (!participant || !participant.alive) {
        member.control = "left";
        await this.commit(room, { events: [], actions: [] }, `disconnect:${room.seq}:${userId}`);
        await this.cleanupEmptyRoom(room);
        return;
      }
      await this.commit(
        room,
        killParticipant(room, participant.id, "disconnect_timeout"),
        `disconnect:${room.seq}:${userId}`,
      );
      await this.cleanupEmptyRoom(room);
      return;
    }

    member.control = "left";
    member.ready = false;
    if (room.hostUserId === userId) this.transferHost(room);
    if (
      !room.members.some(
        (candidate) =>
          candidate.kind === "player" &&
          candidate.control !== "left" &&
          !candidate.isBot,
      )
    ) {
      this.closeRoom(room);
    }
    await this.commit(room, { events: [], actions: [] }, `disconnect:${room.seq}:${userId}`);
    await this.cleanupEmptyRoom(room);
  }
}
