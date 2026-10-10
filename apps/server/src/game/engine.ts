/**
 * 服务端权威游戏规则引擎。
 *
 * 设计原则：
 * 1. 引擎只接收服务器已校验的命令，返回“事件 + 行动日志”。
 * 2. 位置、死亡、倒计时和技能结果都在这里结算，客户端不能决定结果。
 * 3. RoomService 负责把事件持久化，再按玩家身份投影后广播。
 *
 * 新增技能时，优先把规则写在本文件，并通过 visibility 投影控制结果可见范围。
 */
import { randomUUID } from "node:crypto";
import {
  DEATH_REASON_TEXT,
  DEFAULT_MAP_ID,
  MAP_REGISTRY,
  ROLE_CONDUCTOR,
  ROLE_HUNTER,
  ROLE_PAINTER,
  ROLE_REGISTRY,
  ROLE_THIEF,
  ROLE_BUG,
  ROLE_CORPSE,
  ROLE_UNLUCKY,
  SKILL_REGISTRY,
  type ActionLog,
  type BoardMap,
  type DeathReason,
  type Direction,
  type DoorLockState,
  type MapId,
  type PlayerResult,
  type Position,
  type RoleId,
  type SkillId,
  type SkillUseTarget,
} from "@fog-train/shared";
import {
  boardForPlayers,
  crossesCarriageDoor,
  destination,
  legalDirections,
} from "./rules";
import { getSectionAt, isPositionOnMap, positionsEqual } from "@fog-train/shared";
import type {
  EngineEvent,
  EngineResult,
  BookState,
  GameState,
  MemberState,
  ParticipantState,
  RoomState,
  RoomSettings,
} from "../types";

const PARTICIPANT_COLORS = [
  "#e45756",
  "#4c78a8",
  "#f58518",
  "#54a24b",
  "#b279a2",
  "#eeca3b",
  "#72b7b2",
  "#ff9da6",
];

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextRandom(game: GameState): number {
  // 用固定种子和递增计数器生成可复现随机数，便于测试、回放和重启恢复。
  game.rngCounter += 1;
  let value = hashSeed(`${game.seed}:${game.rngCounter}`) || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4_294_967_296;
}

function shuffled<T>(values: T[], game: GameState): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(nextRandom(game) * (index + 1));
    [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  }
  return copy;
}

function makeEvent(
  type: EngineEvent["type"],
  payload: Record<string, unknown>,
  options: {
    round?: number | null;
    actorParticipantId?: string | null;
    now?: string;
  } = {},
): EngineEvent {
  return {
    type,
    round: options.round ?? null,
    actorParticipantId: options.actorParticipantId ?? null,
    payload,
    createdAt: options.now ?? new Date().toISOString(),
  };
}

function participantFromMember(
  member: MemberState,
  index: number,
): ParticipantState {
  return {
    id: randomUUID(),
    userId: member.userId,
    nickname: member.nickname,
    color: member.color || PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]!,
    isBot: member.isBot,
    botDifficulty: member.botDifficulty,
    isGoldenBot: member.isGoldenBot,
    roleId: "",
    position: null,
    initialPosition: null,
    finalPosition: null,
    alive: true,
    waterCountdown: 9,
    drankThisRound: false,
    placedSectionId: null,
    placementComplete: false,
    finalRank: null,
    survivedRounds: 0,
    moveCount: 0,
    skillUseCount: 0,
    killCount: 0,
    waterCount: 0,
    deathRound: null,
    deathReason: null,
    ammo: 0,
    paintUsesRemaining: 0,
    paintSpreadRoundsRemaining: 0,
    lockUsesRemaining: 0,
    lastLockRound: null,
    fogVisionUsesRemaining: 3,
    lastFogVisionRound: null,
    hasBackpack: false,
    prophecyBallAvailable: false,
    invisibilityCloakAvailable: false,
    bookIds: [],
  };
}

function applyRoleDefaults(game: GameState, participant: ParticipantState, roleId: RoleId): void {
  // 角色资源和出生规则统一在这里初始化，避免散落到各技能结算中。
  participant.roleId = roleId;
  if (roleId === ROLE_HUNTER.id) participant.ammo = 1;
  if (roleId === ROLE_THIEF.id) participant.ammo = 1;
  if (roleId === "traveler") {
    participant.hasBackpack = true;
    participant.waterCountdown = 13;
  }
  if (roleId === "sorcerer") {
    participant.prophecyBallAvailable = true;
    participant.invisibilityCloakAvailable = true;
    participant.fogVisionUsesRemaining = 0;
  }
  if (roleId === "archaeologist") {
    const bookId = randomUUID();
    participant.bookIds.push(bookId);
    game.books[bookId] = {
      id: bookId,
      ownerParticipantId: participant.id,
      holderParticipantId: participant.id,
      position: participant.position ? { ...participant.position } : null,
      readsRemaining: 3,
      throwerMarkers: [],
    };
  }
  if (roleId === ROLE_PAINTER.id) participant.paintUsesRemaining = 3;
  if (roleId === ROLE_CORPSE.id) participant.fogVisionUsesRemaining = 0;
  if (roleId === ROLE_CONDUCTOR.id) {
    participant.lockUsesRemaining = 2;
    participant.placedSectionId =
      game.map.sections.find((section) => section.type === "engine")?.id ?? null;
  }
}

export function createGame(
  roomId: string,
  members: MemberState[],
  now = new Date(),
  mapId: MapId = DEFAULT_MAP_ID,
): GameState {
  const players = members
    .filter((member) => member.kind === "player" && member.control !== "left")
    .sort((left, right) => left.joinOrder - right.joinOrder);
  const selectedMap = MAP_REGISTRY[mapId];
  if (!selectedMap?.available) throw new Error("MAP_UNAVAILABLE");
  const map = boardForPlayers(players.length, mapId);
  const game: GameState = {
    id: randomUUID(),
    seed: randomUUID(),
    rngCounter: 0,
    mapId,
    map,
    phase: "role_select",
    participantOrder: [],
    participants: {},
    currentRound: 0,
    completedRounds: 0,
    placementIndex: 0,
    currentTurnIndex: 0,
    currentTurnParticipantId: null,
    currentTurnStartedAt: null,
    deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
    winnerParticipantIds: [],
    finishedAt: null,
    seq: 0,
    actions: [],
    events: [],
    lockedDoors: {},
    paintTiles: [],
    paintTileMeta: {},
    gunshotSignals: [],
    hookSignals: [],
    books: {},
    readingMarks: {},
    pendingFogVision: null,
    fogViews: {},
    conductorActionCounts: {},
  };

  const participants = players.map((member, index) => participantFromMember(member, index));
  for (const participant of participants) {
    game.participants[participant.id] = participant;
  }
  game.participantOrder = shuffled(
    participants.map((participant) => participant.id),
    game,
  );
  return game;
}

export function startRoleSelection(
  room: RoomState,
  now = new Date(),
): EngineResult {
  if (!room.game) throw new Error("GAME_NOT_CREATED");
  room.phase = "role_select";
  room.game.phase = "role_select";
  room.game.deadlineAt = new Date(
    now.getTime() + room.settings.turnTimeoutMs,
  ).toISOString();
  room.game.currentTurnParticipantId = null;
  const events = [
    makeEvent(
      "map_selected",
      {
        mapId: room.mapId,
        mapName: MAP_REGISTRY[room.mapId].name,
      },
      { now: now.toISOString() },
    ),
    makeEvent("phase_changed", { phase: "role_select" }, { now: now.toISOString() }),
  ];
  return { events, actions: [] };
}

export function roomPlayers(room: RoomState): MemberState[] {
  return room.members
    .filter((member) => member.kind === "player" && member.control !== "left")
    .sort((left, right) => left.joinOrder - right.joinOrder);
}

export function aliveParticipants(game: GameState): ParticipantState[] {
  return Object.values(game.participants).filter((participant) => participant.alive);
}

export function findParticipantByUser(
  game: GameState,
  userId: string,
): ParticipantState | undefined {
  return Object.values(game.participants).find((participant) => participant.userId === userId);
}

export function currentPlacementParticipant(game: GameState): ParticipantState | null {
  for (let index = game.placementIndex; index < game.participantOrder.length; index += 1) {
    const participant = game.participants[game.participantOrder[index]!];
    if (participant?.alive && !participant.placementComplete) return participant;
  }
  return null;
}

export function currentTurnParticipant(game: GameState): ParticipantState | null {
  if (!game.currentTurnParticipantId) return null;
  const participant = game.participants[game.currentTurnParticipantId];
  return participant?.alive ? participant : null;
}

export function chooseRole(
  room: RoomState,
  userId: string,
  roleId: string,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "role_select") throw new Error("WRONG_PHASE");
  const role = ROLE_REGISTRY[roleId as RoleId];
  if (!role) throw new Error("UNKNOWN_ROLE");
  if (!role.available) throw new Error("ROLE_UNAVAILABLE");
  if (role.requiredMapId && room.mapId !== role.requiredMapId) {
    throw new Error("ROLE_MAP_LOCKED");
  }
  const participant = findParticipantByUser(room.game, userId);
  if (!participant || !participant.alive) throw new Error("PLAYER_NOT_ALIVE");
  if (participant.roleId) throw new Error("ROLE_ALREADY_SELECTED");
  if (
    roleId === ROLE_CONDUCTOR.id &&
    Object.values(room.game.participants).some(
      (candidate) => candidate.id !== participant.id && candidate.roleId === ROLE_CONDUCTOR.id,
    )
  ) {
    throw new Error("CONDUCTOR_ALREADY_SELECTED");
  }
  if (
    roleId === "sorcerer" &&
    Object.values(room.game.participants).some(
      (candidate) => candidate.id !== participant.id && candidate.roleId === "sorcerer",
    )
  ) {
    throw new Error("SORCERER_ALREADY_SELECTED");
  }
  applyRoleDefaults(room.game, participant, roleId as RoleId);

  const events: EngineEvent[] = [
    makeEvent(
      "role_selected",
      {
        participantId: participant.id,
        nickname: participant.nickname,
        roleId: role.id,
        roleName: role.name,
      },
      { actorParticipantId: participant.id, now: now.toISOString() },
    ),
  ];
  const alive = aliveParticipants(room.game);
  if (alive.every((candidate) => Boolean(candidate.roleId))) {
    events.push(...beginPlacement(room, now));
  }
  return { events, actions: [] };
}

export function autoCompleteRoleSelection(
  room: RoomState,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "role_select") return { events: [], actions: [] };
  const events: EngineEvent[] = [];
  for (const participant of aliveParticipants(room.game)) {
    if (!participant.roleId) {
      applyRoleDefaults(room.game, participant, ROLE_UNLUCKY.id);
      events.push(
        makeEvent(
          "role_selected",
          {
            participantId: participant.id,
            nickname: participant.nickname,
            roleId: ROLE_UNLUCKY.id,
            roleName: ROLE_UNLUCKY.name,
            autoAssigned: true,
          },
          { actorParticipantId: participant.id, now: now.toISOString() },
        ),
      );
    }
  }
  events.push(
    makeEvent(
      "activity",
      { reason: "role_select_timeout", autoAssignedRoleId: ROLE_UNLUCKY.id },
      { now: now.toISOString() },
    ),
    ...beginPlacement(room, now),
  );
  return { events, actions: [] };
}

function beginPlacement(room: RoomState, now: Date): EngineEvent[] {
  // 选位按固定行动顺序逐个进行；列车长在角色初始化时已占用车头。
  if (!room.game) return [];
  room.phase = "placement";
  room.game.phase = "placement";
  room.game.placementIndex = 0;
  room.game.currentTurnParticipantId = null;
  room.game.deadlineAt = new Date(
    now.getTime() + room.settings.turnTimeoutMs,
  ).toISOString();
  const current = currentPlacementParticipant(room.game);
  if (current) {
    room.game.currentTurnParticipantId = current.id;
  }
  return [
    makeEvent("phase_changed", { phase: "placement" }, { now: now.toISOString() }),
    makeEvent(
      "activity",
      {
        actorParticipantId: current?.id ?? null,
        nickname: current?.nickname ?? null,
        phase: "placement",
        deadlineAt: room.game.deadlineAt,
      },
      { actorParticipantId: current?.id ?? null, now: now.toISOString() },
    ),
  ];
}

export function choosePlacementSection(
  room: RoomState,
  userId: string,
  sectionId: string,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "placement") throw new Error("WRONG_PHASE");
  const current = currentPlacementParticipant(room.game);
  if (!current || current.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (current.placedSectionId) throw new Error("SECTION_ALREADY_CHOSEN");
  if (current.roleId === ROLE_CONDUCTOR.id) throw new Error("CONDUCTOR_USES_ENGINE");
  const section = room.game.map.sections.find((candidate) => candidate.id === sectionId);
  if (!section || section.type !== "carriage") throw new Error("INVALID_SECTION");
  if (
    Object.values(room.game.participants).some(
      (participant) =>
        participant.id !== current.id &&
        participant.alive &&
        participant.placedSectionId === sectionId,
    )
  ) {
    throw new Error("SECTION_OCCUPIED");
  }
  current.placedSectionId = sectionId;
  return {
    events: [
      makeEvent(
        "activity",
        {
          actorParticipantId: current.id,
          nickname: current.nickname,
          selectedSectionId: sectionId,
        },
        { actorParticipantId: current.id, now: now.toISOString() },
      ),
    ],
    actions: [],
  };
}

export function choosePlacementCell(
  room: RoomState,
  userId: string,
  position: Position,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "placement") throw new Error("WRONG_PHASE");
  const current = currentPlacementParticipant(room.game);
  if (!current || current.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (current.roleId === ROLE_CONDUCTOR.id && !current.placedSectionId) {
    current.placedSectionId =
      room.game.map.sections.find((section) => section.type === "engine")?.id ?? null;
  }
  if (!current.placedSectionId) throw new Error("SECTION_NOT_CHOSEN");
  const section = room.game.map.sections.find(
    (candidate) => candidate.id === current.placedSectionId,
  );
  if (!section) throw new Error("INVALID_SECTION");
  if (
    position.x < 0 ||
    position.x >= room.game.map.columns ||
    position.y < section.startY ||
    position.y > section.endY
  ) {
    throw new Error("INVALID_CELL");
  }
  if (
    Object.values(room.game.participants).some(
      (participant) =>
        participant.id !== current.id &&
        participant.position &&
        participant.position.x === position.x &&
        participant.position.y === position.y,
    )
  ) {
    throw new Error("CELL_OCCUPIED");
  }

  current.position = { ...position };
  current.initialPosition = { ...position };
  syncHeldBooks(room.game, current);
  current.placementComplete = true;
  room.game.placementIndex += 1;
  const events: EngineEvent[] = [];
  const actions: ActionLog[] = [];

  let next = currentPlacementParticipant(room.game);
  while (next && next.placementComplete) {
    room.game.placementIndex += 1;
    next = currentPlacementParticipant(room.game);
  }

  if (!next) {
    room.game.currentTurnParticipantId = null;
    events.push(
      makeEvent("placement_completed", {}, { now: now.toISOString() }),
      ...startPlaying(room, now, actions),
    );
  } else {
    room.game.currentTurnParticipantId = next.id;
    room.game.currentTurnStartedAt = now.toISOString();
    room.game.deadlineAt = new Date(
      now.getTime() + room.settings.turnTimeoutMs,
    ).toISOString();
    events.push(
      makeEvent(
        "activity",
        {
          actorParticipantId: next.id,
          nickname: next.nickname,
          phase: "placement",
          deadlineAt: room.game.deadlineAt,
        },
        { actorParticipantId: next.id, now: now.toISOString() },
      ),
    );
  }
  return { events, actions };
}

export function autoCompleteCurrentPlacement(
  room: RoomState,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "placement") return { events: [], actions: [] };
  const current = currentPlacementParticipant(room.game);
  if (!current) return { events: [], actions: [] };

  if (current.roleId === ROLE_CONDUCTOR.id) {
    current.placedSectionId =
      room.game.map.sections.find((section) => section.type === "engine")?.id ?? null;
  }

  if (!current.placedSectionId) {
    const available = room.game.map.sections.filter(
      (section) =>
        section.type === "carriage" &&
        !Object.values(room.game!.participants).some(
          (participant) =>
            participant.alive &&
            participant.id !== current.id &&
            participant.placedSectionId === section.id,
        ),
    );
    const selected = available[Math.floor(nextRandom(room.game) * available.length)];
    if (!selected) throw new Error("NO_AVAILABLE_SECTION");
    current.placedSectionId = selected.id;
  }

  const section = room.game.map.sections.find(
    (candidate) => candidate.id === current.placedSectionId,
  );
  if (!section) throw new Error("INVALID_SECTION");
  const occupied = new Set(
    Object.values(room.game.participants)
      .filter((participant) => participant.id !== current.id && participant.position)
      .map((participant) => `${participant.position!.x}:${participant.position!.y}`),
  );
  const candidates: Position[] = [];
  for (let y = section.startY; y <= section.endY; y += 1) {
    for (let x = 0; x < room.game.map.columns; x += 1) {
      if (!occupied.has(`${x}:${y}`)) candidates.push({ x, y });
    }
  }
  const position = candidates[Math.floor(nextRandom(room.game) * candidates.length)];
  if (!position) throw new Error("NO_AVAILABLE_CELL");

  const result = choosePlacementCell(room, current.userId, position, now);
  result.actions.push({
    id: randomUUID(),
    seq: room.game.actions.length + 1,
    round: null,
    participantId: current.id,
    actionType: "auto_place",
    fromPosition: null,
    toPosition: position,
    direction: null,
    crossedDoor: false,
    drank: false,
    skillId: null,
    skillTarget: null,
    killedParticipantIds: [],
    died: false,
    createdAt: now.toISOString(),
  });
  return result;
}

function startPlaying(
  room: RoomState,
  now: Date,
  actions: ActionLog[] = [],
): EngineEvent[] {
  if (!room.game) return [];
  room.phase = "playing";
  room.game.phase = "playing";
  room.startedAt = room.startedAt ?? now.toISOString();
  return startNextRound(room, now, actions);
}

function startNextRound(
  room: RoomState,
  now: Date,
  actions: ActionLog[] = [],
): EngineEvent[] {
  // 回合开始先结算喝水归零，再寻找第一个可行动玩家。
  // 这样上一轮结束时倒计时归零的玩家不会抢到下一轮行动。
  if (!room.game || room.game.phase === "finished") return [];
  room.game.currentRound += 1;
  clearExpiredReadingMarks(room.game, null);
  room.game.currentTurnIndex = -1;
  room.game.currentTurnParticipantId = null;
  for (const participant of Object.values(room.game.participants)) {
    participant.drankThisRound = false;
  }

  const events: EngineEvent[] = [
    makeEvent(
      "round_started",
      { round: room.game.currentRound },
      { round: room.game.currentRound, now: now.toISOString() },
    ),
  ];
  refreshPaintStatusAtRoundStart(room.game);

  for (const participant of aliveParticipants(room.game)) {
    if (!isCorpse(participant) && participant.waterCountdown <= 0) {
      events.push(...markDeath(room.game, participant, "thirst", now));
    }
  }
  if (checkAndFinishGame(room, now, events)) return events;

  const next = selectNextTurn(room, now, events, -1, actions);
  if (!next) {
    return [...events, ...finishWithoutSurvivors(room, now)];
  }
  return events;
}

function nextAliveTurn(game: GameState, fromIndex: number): ParticipantState | null {
  for (let index = fromIndex + 1; index < game.participantOrder.length; index += 1) {
    const participant = game.participants[game.participantOrder[index]!];
    if (participant?.alive) return participant;
  }
  return null;
}

function isBug(participant: ParticipantState): boolean {
  return participant.roleId === ROLE_BUG.id;
}

function isCorpse(participant: ParticipantState): boolean {
  return participant.roleId === ROLE_CORPSE.id;
}

function makeSkipAction(
  game: GameState,
  participant: ParticipantState,
  now: Date,
  reason: string,
): ActionLog {
  return {
    id: randomUUID(),
    seq: game.actions.length + 1,
    round: game.currentRound,
    participantId: participant.id,
    actionType: "skip",
    fromPosition: participant.position,
    toPosition: participant.position,
    direction: null,
    crossedDoor: false,
    drank: false,
    skillId: null,
    skillTarget: { automatic: true, reason },
    killedParticipantIds: [],
    died: false,
    createdAt: now.toISOString(),
  };
}

function selectNextTurn(
  room: RoomState,
  now: Date,
  events: EngineEvent[],
  fromIndex: number,
  actions: ActionLog[],
): ParticipantState | null {
  if (!room.game) return null;
  const game = room.game;
  for (let index = fromIndex + 1; index < game.participantOrder.length; index += 1) {
    const participant = game.participants[game.participantOrder[index]!];
    if (!participant?.alive) continue;
    game.currentTurnIndex = index;
    if (isCorpse(participant)) {
      // 尸体没有可操作回合，但仍保留行动日志并用 skip 推动顺序。
      const action = makeSkipAction(game, participant, now, "corpse_auto_skip");
      game.actions.push(action);
      actions.push(action);
      continue;
    }
    game.currentTurnParticipantId = participant.id;
    game.currentTurnStartedAt = now.toISOString();
    game.deadlineAt = new Date(
      now.getTime() + room.settings.turnTimeoutMs,
    ).toISOString();
    events.push(
      makeEvent(
        "activity",
        {
          actorParticipantId: participant.id,
          nickname: participant.nickname,
          phase: "playing",
          round: game.currentRound,
          deadlineAt: game.deadlineAt,
        },
        {
          actorParticipantId: participant.id,
          round: game.currentRound,
          now: now.toISOString(),
        },
      ),
    );
    return participant;
  }
  game.currentTurnParticipantId = null;
  game.currentTurnStartedAt = null;
  game.deadlineAt = null;
  return null;
}

function orderedConnectionSections(
  map: BoardMap,
  leftId: string,
  rightId: string,
): { upper: ReturnType<typeof getSectionAt>; lower: ReturnType<typeof getSectionAt> } | null {
  const left = map.sections.find((section) => section.id === leftId);
  const right = map.sections.find((section) => section.id === rightId);
  if (!left || !right) return null;
  return left.startY < right.startY
    ? { upper: left, lower: right }
    : { upper: right, lower: left };
}

function connectionIdForSections(
  map: BoardMap,
  firstSectionId: string,
  secondSectionId: string,
): string | null {
  const ordered = orderedConnectionSections(map, firstSectionId, secondSectionId);
  if (!ordered?.upper || !ordered.lower) return null;
  return `${ordered.upper.id}:${ordered.lower.id}`;
}

export function connectionIdForMove(
  map: BoardMap,
  from: Position,
  to: Position,
): string | null {
  const fromSection = getSectionAt(map, from);
  const toSection = getSectionAt(map, to);
  if (!fromSection || !toSection || fromSection.id === toSection.id) return null;
  return connectionIdForSections(map, fromSection.id, toSection.id);
}

export function nearestConnectionForPosition(
  map: BoardMap,
  position: Position,
): string | null {
  for (let index = 0; index < map.sections.length - 1; index += 1) {
    const upper = map.sections[index]!;
    const lower = map.sections[index + 1]!;
    if (position.y === upper.endY || position.y === lower.startY) {
      return `${upper.id}:${lower.id}`;
    }
  }
  return null;
}

function isLockedConnection(
  game: GameState,
  from: Position,
  to: Position,
): boolean {
  const connectionId = connectionIdForMove(game.map, from, to);
  return Boolean(connectionId && game.lockedDoors[connectionId]);
}

export function positionKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

function replenishThiefHook(game: GameState, participant: ParticipantState): void {
  if (!participant.alive || participant.roleId !== ROLE_THIEF.id || !participant.position) {
    return;
  }
  if (getSectionAt(game.map, participant.position)?.type === "storage") {
    participant.ammo = 1;
  }
}

export function legalMovementDirections(
  game: GameState,
  participant: ParticipantState,
): Direction[] {
  if (isCorpse(participant)) return [];
  if (!participant.position) return [];
  return legalDirections(game.map, participant.position).filter(
    (direction) =>
      !isLockedConnection(
        game,
        participant.position!,
        destination(participant.position!, direction),
      ),
  );
}

function hasPaint(game: GameState, position: Position): boolean {
  return game.paintTiles.some((tile) => positionKey(tile) === positionKey(position));
}

function addPaint(
  game: GameState,
  position: Position,
  events: EngineEvent[],
  now: Date,
  source: "skill" | "spread" = "spread",
  creatorParticipantId = "system",
): void {
  // 每个白漆格记录来源回合、来源玩家和产生方式。
  // 粉刷匠区分“上一回合技能倒在自己脚下”和普通扩散，避免无限续期。
  if (hasPaint(game, position)) return;
  game.paintTiles.push({ ...position });
  game.paintTileMeta[positionKey(position)] = {
    createdRound: game.currentRound,
    creatorParticipantId,
    source,
  };
  events.push(
    makeEvent(
      "paint_applied",
      { position: { ...position }, source },
      { round: game.currentRound || null, now: now.toISOString() },
    ),
  );
}

function applyPaintAfterMove(
  game: GameState,
  participant: ParticipantState,
  from: Position,
  to: Position,
  events: EngineEvent[],
  now: Date,
): void {
  // 进入白漆的这一步不扩散；只有已经获得扩散次数后，移动到无漆格才会染白目标格。
  const targetPainted = hasPaint(game, to);

  if (targetPainted) {
    const tile = game.paintTileMeta[positionKey(to)];
    const ownPreviousRoundPaint =
      tile?.creatorParticipantId === participant.id &&
      tile.createdRound === game.currentRound - 1;
    if (!ownPreviousRoundPaint) {
      participant.paintSpreadRoundsRemaining = 3;
    }
    return;
  }

  if (participant.paintSpreadRoundsRemaining <= 0) return;
  addPaint(game, to, events, now, "spread", participant.id);
}

function refreshPaintStatusAtRoundStart(game: GameState): void {
  for (const participant of aliveParticipants(game)) {
    if (!participant.position) continue;
    const tile = game.paintTileMeta[positionKey(participant.position)];
    if (!tile) continue;
    const ownPreviousRoundPaint =
      tile.creatorParticipantId === participant.id &&
      tile.createdRound === game.currentRound - 1;
    const painterOwnSkillPaint =
      participant.roleId === ROLE_PAINTER.id &&
      ownPreviousRoundPaint &&
      tile.source === "skill";
    if (!ownPreviousRoundPaint || painterOwnSkillPaint) {
      participant.paintSpreadRoundsRemaining = 2;
    }
  }
}

function tickPaintSpreadAfterRound(game: GameState): void {
  for (const participant of aliveParticipants(game)) {
    participant.paintSpreadRoundsRemaining = Math.max(
      0,
      participant.paintSpreadRoundsRemaining - 1,
    );
  }
}

function tickConductorLocksAfterAction(
  game: GameState,
  conductorId: string,
  now: Date,
): EngineEvent[] {
  if (game.participants[conductorId]?.roleId !== ROLE_CONDUCTOR.id) return [];
  game.conductorActionCounts[conductorId] =
    (game.conductorActionCounts[conductorId] ?? 0) + 1;
  const events: EngineEvent[] = [];
  for (const [connectionId, lock] of Object.entries(game.lockedDoors)) {
    if (lock.ownerParticipantId !== conductorId) continue;
    lock.remainingConductorTurns = Math.max(0, lock.remainingConductorTurns - 1);
    if (lock.remainingConductorTurns === 0) {
      delete game.lockedDoors[connectionId];
      events.push(
        makeEvent(
          "door_unlocked",
          { connectionId, reason: "expired" },
          { round: game.currentRound, actorParticipantId: conductorId, now: now.toISOString() },
        ),
      );
    }
  }
  return events;
}

function unlockConductorDoors(
  game: GameState,
  conductorId: string,
  now: Date,
  reason: string,
): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const [connectionId, lock] of Object.entries(game.lockedDoors)) {
    if (lock.ownerParticipantId !== conductorId) continue;
    delete game.lockedDoors[connectionId];
    events.push(
      makeEvent(
        "door_unlocked",
        { connectionId, reason },
        { round: game.currentRound || null, actorParticipantId: conductorId, now: now.toISOString() },
      ),
    );
  }
  return events;
}

function samePosition(left: Position | null, right: Position | null): boolean {
  return Boolean(left && right && positionsEqual(left, right));
}

function pickupBook(
  game: GameState,
  book: BookState,
  participant: ParticipantState,
  events: EngineEvent[],
  now: Date,
): void {
  if (!participant.alive || !participant.position) return;
  book.holderParticipantId = participant.id;
  book.position = { ...participant.position };
  if (!participant.bookIds.includes(book.id)) participant.bookIds.push(book.id);
  events.push(
    makeEvent(
      "book_picked_up",
      {
        bookId: book.id,
        participantId: participant.id,
        nickname: participant.nickname,
        position: { ...participant.position },
      },
      { round: game.currentRound || null, actorParticipantId: participant.id, now: now.toISOString() },
    ),
  );
}

function syncHeldBooks(game: GameState, participant: ParticipantState): void {
  if (!participant.position) return;
  for (const bookId of participant.bookIds) {
    const book = game.books[bookId];
    if (book?.holderParticipantId === participant.id) {
      book.position = { ...participant.position };
    }
  }
}

function clearThrowerMarkersAt(
  game: GameState,
  throwerParticipantId: string,
  position: Position,
  events: EngineEvent[],
  now: Date,
): void {
  for (const book of Object.values(game.books)) {
    for (const marker of book.throwerMarkers) {
      if (
        marker.active &&
        marker.throwerParticipantId === throwerParticipantId &&
        positionsEqual(marker.position, position)
      ) {
        marker.active = false;
        events.push(
          makeEvent(
            "book_marker_cleared",
            {
              bookId: book.id,
              markerId: marker.id,
              participantId: throwerParticipantId,
              position: { ...position },
            },
            { round: game.currentRound || null, actorParticipantId: throwerParticipantId, now: now.toISOString() },
          ),
        );
      }
    }
  }
}

function pickupBooksAtPosition(
  game: GameState,
  participant: ParticipantState,
  events: EngineEvent[],
  now: Date,
): void {
  if (!participant.alive || !participant.position) return;
  clearThrowerMarkersAt(game, participant.id, participant.position, events, now);
  for (const book of Object.values(game.books)) {
    if (book.holderParticipantId || !samePosition(book.position, participant.position)) continue;
    pickupBook(game, book, participant, events, now);
  }
}

function dropBooksForParticipant(
  game: GameState,
  participant: ParticipantState,
  events: EngineEvent[],
  now: Date,
): void {
  const position = participant.position ? { ...participant.position } : null;
  for (const book of Object.values(game.books)) {
    if (book.holderParticipantId !== participant.id) continue;
    book.holderParticipantId = null;
    book.position = position;
    participant.bookIds = participant.bookIds.filter((id) => id !== book.id);
    events.push(
      makeEvent(
        "book_dropped",
        {
          bookId: book.id,
          participantId: participant.id,
          position,
        },
        { round: game.currentRound || null, actorParticipantId: participant.id, now: now.toISOString() },
      ),
    );
    if (!position) continue;
    const occupant = Object.values(game.participants).find(
      (candidate) =>
        candidate.alive &&
        candidate.id !== participant.id &&
        samePosition(candidate.position, position),
    );
    if (occupant) pickupBook(game, book, occupant, events, now);
  }
}

function endRound(
  room: RoomState,
  now: Date,
  actions: ActionLog[] = [],
): EngineEvent[] {
  if (!room.game) return [];
  const round = room.game.currentRound;
  for (const participant of aliveParticipants(room.game)) {
    // 本轮经过“车厢—车厢”门会立即重置为 9；否则回合结束扣 1。
    if (!isCorpse(participant) && !participant.drankThisRound) {
      participant.waterCountdown = Math.max(0, participant.waterCountdown - 1);
    }
  }
  // 白漆扩散按全局回合倒计时，而不是按玩家移动次数倒计时。
  tickPaintSpreadAfterRound(room.game);
  room.game.completedRounds += 1;
  const events = [
    makeEvent(
      "round_ended",
      { round, completedRounds: room.game.completedRounds },
      { round, now: now.toISOString() },
    ),
  ];
  events.push(...startNextRound(room, now, actions));
  return events;
}

function clearExpiredReadingMarks(
  game: GameState,
  actorId: string | null,
): void {
  for (const [ownerId, mark] of Object.entries(game.readingMarks)) {
    const owner = game.participants[ownerId];
    if (!owner) {
      delete game.readingMarks[ownerId];
      continue;
    }
    if (
      (!owner.alive && mark.createdRound < game.currentRound) ||
      (actorId === ownerId && mark.createdRound < game.currentRound)
    ) {
      delete game.readingMarks[ownerId];
    }
  }
}

function markDeath(
  game: GameState,
  participant: ParticipantState,
  reason: DeathReason,
  now: Date,
  killerParticipantId: string | null = null,
): EngineEvent[] {
  if (!participant.alive) return [];
  participant.alive = false;
  participant.finalPosition = participant.position ? { ...participant.position } : null;
  participant.deathRound = game.currentRound;
  participant.deathReason = reason;
  participant.survivedRounds = game.completedRounds;
  // 事件中包含位置和凶手，供服务端结算与赛后回放；实时公屏投影会剔除这些字段。
  const events: EngineEvent[] = [
    makeEvent(
      "death",
      {
        participantId: participant.id,
        nickname: participant.nickname,
        reason,
        publicReason: DEATH_REASON_TEXT[reason],
        position: participant.position,
        killerParticipantId,
      },
      {
        round: game.currentRound || null,
        actorParticipantId: killerParticipantId,
        now: now.toISOString(),
      },
    ),
  ];
  if (participant.roleId === ROLE_CONDUCTOR.id) {
    events.push(...unlockConductorDoors(game, participant.id, now, "owner_died"));
  }
  dropBooksForParticipant(game, participant, events, now);
  return events;
}

function resolveMovementContact(
  game: GameState,
  mover: ParticipantState,
  target: Position,
  events: EngineEvent[],
  now: Date,
): { actorDied: boolean; killedParticipantIds: string[] } {
  const occupant = Object.values(game.participants).find(
    (participant) =>
      participant.alive &&
      participant.id !== mover.id &&
      participant.position?.x === target.x &&
      participant.position?.y === target.y,
  );
  if (!occupant) return { actorDied: false, killedParticipantIds: [] };

  if (isBug(mover) || isBug(occupant)) {
    events.push(...markDeath(game, mover, "bug_contact", now));
    return { actorDied: true, killedParticipantIds: [] };
  }

  mover.killCount += 1;
  events.push(...markDeath(game, occupant, "squeeze", now, mover.id));
  return { actorDied: false, killedParticipantIds: [occupant.id] };
}

function tryConsumeBackpack(
  game: GameState,
  target: ParticipantState,
  source: string,
  events: EngineEvent[],
  now: Date,
): boolean {
  if (target.roleId !== "traveler" || !target.hasBackpack) return false;
  target.hasBackpack = false;
  events.push(
    makeEvent(
      "item_used",
      {
        itemId: "backpack",
        participantId: target.id,
        nickname: target.nickname,
        source,
        consumed: true,
      },
      { round: game.currentRound || null, actorParticipantId: target.id, now: now.toISOString() },
    ),
  );
  return true;
}

export function applyMove(
  room: RoomState,
  userId: string,
  direction: Direction,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "playing") throw new Error("WRONG_PHASE");
  if (room.game.pendingFogVision) throw new Error("FOG_DECISION_PENDING");
  const actor = currentTurnParticipant(room.game);
  if (!actor || actor.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (isCorpse(actor)) throw new Error("CORPSE_CANNOT_MOVE");
  if (!actor.position) throw new Error("PLAYER_HAS_NO_POSITION");
  const target = destination(actor.position, direction);
  if (!legalDirections(room.game.map, actor.position).includes(direction)) {
    throw new Error("ILLEGAL_MOVE");
  }
  if (isLockedConnection(room.game, actor.position, target)) {
    throw new Error("DOOR_LOCKED");
  }

  const from = { ...actor.position };
  actor.position = target;
  syncHeldBooks(room.game, actor);
  actor.moveCount += 1;
  const drank = crossesCarriageDoor(room.game.map, from, target);
  if (drank) {
    actor.waterCountdown = actor.roleId === "traveler" ? 13 : 9;
    actor.drankThisRound = true;
    actor.waterCount += 1;
  }
  const targetSection = getSectionAt(room.game.map, target);
  if (actor.roleId === ROLE_HUNTER.id && targetSection?.type === "storage") {
    actor.ammo = 1;
  }
  replenishThiefHook(room.game, actor);

  const killedParticipantIds: string[] = [];
  const events: EngineEvent[] = [
    makeEvent(
      "actor_moved",
      {
        participantId: actor.id,
        userId: actor.userId,
        nickname: actor.nickname,
        from,
        to: target,
        direction,
        drank,
      },
      {
        round: room.game.currentRound,
        actorParticipantId: actor.id,
        now: now.toISOString(),
      },
    ),
  ];
  applyPaintAfterMove(room.game, actor, from, target, events, now);
  if (drank) {
    events.push(
      makeEvent(
        "drank",
        {
          participantId: actor.id,
          nickname: actor.nickname,
          position: target,
          waterCountdown: actor.waterCountdown,
        },
        {
          round: room.game.currentRound,
          actorParticipantId: actor.id,
          now: now.toISOString(),
        },
      ),
    );
  }

  const contact = resolveMovementContact(room.game, actor, target, events, now);
  killedParticipantIds.push(...contact.killedParticipantIds);
  if (actor.alive) pickupBooksAtPosition(room.game, actor, events, now);

  const actionSeq = room.game.actions.length + 1;
  const action: ActionLog = {
    id: randomUUID(),
    seq: actionSeq,
    round: room.game.currentRound,
    participantId: actor.id,
    actionType: "move",
    fromPosition: from,
    toPosition: target,
    direction,
    crossedDoor: drank,
    drank,
    skillId: null,
    skillTarget: null,
    killedParticipantIds,
    died: contact.actorDied,
    createdAt: now.toISOString(),
  };
  room.game.actions.push(action);
  events.push(...tickConductorLocksAfterAction(room.game, actor.id, now));

  if (checkAndFinishGame(room, now, events)) {
    return { events, actions: [action] };
  }
  const followUpActions: ActionLog[] = [];
  events.push(...advanceTurn(room, now, actor.id, followUpActions));
  return { events, actions: [action, ...followUpActions] };
}

function clearFogView(game: GameState, viewerParticipantId: string, now: Date): EngineEvent[] {
  const active = game.fogViews[viewerParticipantId];
  if (!active) return [];
  delete game.fogViews[viewerParticipantId];
  return [
    makeEvent(
      "fog_vision_ended",
      {
        participantId: active.casterParticipantId,
      },
      { round: game.currentRound || null, now: now.toISOString() },
    ),
  ];
}

function advanceTurn(
  room: RoomState,
  now: Date,
  actorId: string | null = null,
  actions: ActionLog[] = [],
): EngineEvent[] {
  if (!room.game || room.game.phase !== "playing") return [];
  // 雾视结果由查看者自己持有，直到其下一次雾视或下一次预言球结算。
  const events: EngineEvent[] = [];
  clearExpiredReadingMarks(room.game, actorId);
  const next = selectNextTurn(room, now, events, room.game.currentTurnIndex, actions);
  if (!next) return [...events, ...endRound(room, now, actions)];
  return events;
}

const ORTHOGONAL_DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: "down",
  up_right: "down_left",
  right: "left",
  down_right: "up_left",
  down: "up",
  down_left: "up_right",
  left: "right",
  up_left: "down_right",
};

export function skillUnavailableReason(
  game: GameState,
  participant: ParticipantState,
): string | null {
  if (participant.roleId === ROLE_UNLUCKY.id) return "该角色没有技能";
  if (participant.roleId === ROLE_HUNTER.id && participant.ammo <= 0) return "没有子弹";
  if (participant.roleId === ROLE_THIEF.id && participant.ammo <= 0) return "没有钩子";
  if (participant.roleId === ROLE_CORPSE.id) return "尸体不能使用技能";
  if (participant.roleId === ROLE_CONDUCTOR.id) {
    if (participant.lockUsesRemaining <= 0) return "锁门次数已用完";
    if (participant.lastLockRound === game.currentRound) return "本回合已经锁过门";
    if (!participant.position || !nearestConnectionForPosition(game.map, participant.position)) {
      return "当前不在可封锁的连接处旁";
    }
  }
  if (participant.roleId === ROLE_PAINTER.id && participant.paintUsesRemaining <= 0) {
    return "白漆已用完";
  }
  return null;
}

export function fogVisionUnavailableReason(
  game: GameState,
  participant: ParticipantState,
): string | null {
  if (participant.roleId === ROLE_CORPSE.id) return "尸体无法使用雾视";
  if (participant.roleId === "sorcerer") return "咒术师无法进行雾视";
  if (participant.fogVisionUsesRemaining <= 0) return "雾视次数已用完";
  if (participant.lastFogVisionRound === game.currentRound) return "本回合已经使用过雾视";
  return null;
}

export function useFogVision(
  room: RoomState,
  userId: string,
  now = new Date(),
): EngineResult {
  // 雾视是所有角色共用的独立行动：每局 3 次、每轮 1 次，并消耗当前回合。
  // 结果按查看者保存在 fogViews 中，由 snapshot 投影给对应玩家。
  if (!room.game || room.phase !== "playing") throw new Error("WRONG_PHASE");
  if (room.game.pendingFogVision) throw new Error("FOG_DECISION_PENDING");
  const game = room.game;
  const actor = currentTurnParticipant(game);
  if (!actor || actor.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (!actor.position) throw new Error("PLAYER_HAS_NO_POSITION");
  if (game.pendingFogVision) throw new Error("FOG_DECISION_PENDING");
  if (fogVisionUnavailableReason(game, actor)) throw new Error("FOG_VISION_UNAVAILABLE");

  const events: EngineEvent[] = clearFogView(game, actor.id, now);
  const sorcerer = aliveParticipants(game).find(
    (participant) => participant.roleId === "sorcerer",
  );
  const durationMs = sorcerer ? 10_000 : 1_000;
  const deadlineAt = new Date(now.getTime() + durationMs).toISOString();
  const rawPositions = aliveParticipants(game)
    // 雾视只揭示其他人的位置，发动者自己的位置始终排除在结果之外。
    .filter((participant) => participant.id !== actor.id && participant.position)
    .map((participant) => ({
      participantId: participant.id,
      position: { ...participant.position! },
    }));
  actor.fogVisionUsesRemaining -= 1;
  actor.lastFogVisionRound = game.currentRound;
  game.pendingFogVision = {
    id: randomUUID(),
    casterParticipantId: actor.id,
    casterNickname: actor.nickname,
    deadlineAt,
    sorcererParticipantId: sorcerer?.id ?? null,
    responded: !sorcerer,
    prophecyBallUsed: false,
    invisibilityUsed: false,
    rawPositions,
    createdAt: now.toISOString(),
  };
  game.deadlineAt = deadlineAt;
  events.push(
    makeEvent(
      "fog_vision_used",
      {
        participantId: actor.id,
        nickname: actor.nickname,
        position: { ...actor.position },
      },
      { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
    ),
  );
  actor.skillUseCount += 1;
  const action: ActionLog = {
    id: randomUUID(),
    seq: game.actions.length + 1,
    round: game.currentRound,
    participantId: actor.id,
    actionType: "fog_vision",
    fromPosition: { ...actor.position },
    toPosition: { ...actor.position },
    direction: null,
    crossedDoor: false,
    drank: false,
    skillId: null,
    skillTarget: null,
    killedParticipantIds: [],
    died: false,
    createdAt: now.toISOString(),
  };
  game.actions.push(action);
  replenishThiefHook(game, actor);
  return { events, actions: [action] };
}

export function resolvePendingFogVision(
  room: RoomState,
  now = new Date(),
): EngineResult {
  const pending = room.game?.pendingFogVision;
  if (!room.game || !pending) return { events: [], actions: [] };
  const game = room.game;
  const sorcerer = pending.sorcererParticipantId
    ? game.participants[pending.sorcererParticipantId]
    : null;
  const hiddenIds = new Set<string>();
  if (pending.invisibilityUsed && sorcerer) hiddenIds.add(sorcerer.id);
  const positions = pending.rawPositions
    .filter((entry) => !hiddenIds.has(entry.participantId))
    .map((entry) => ({ ...entry.position }));
  const viewerParticipantIds = [pending.casterParticipantId];
  if (pending.prophecyBallUsed && sorcerer) viewerParticipantIds.push(sorcerer.id);

  const activeFogVision = {
    id: pending.id,
    casterParticipantId: pending.casterParticipantId,
    round: game.currentRound,
    positions,
    createdAt: now.toISOString(),
  };
  game.fogViews[pending.casterParticipantId] = activeFogVision;
  if (pending.prophecyBallUsed && sorcerer) {
    // 预言球结果只在下一次实际获得新结果时替换，其他雾视不会清掉旧结果。
    game.fogViews[sorcerer.id] = activeFogVision;
  }
  game.pendingFogVision = null;
  const events: EngineEvent[] = [];
  const actions: ActionLog[] = [];

  if (sorcerer && (pending.prophecyBallUsed || pending.invisibilityUsed)) {
    if (pending.invisibilityUsed) sorcerer.invisibilityCloakAvailable = false;
    sorcerer.skillUseCount += 1;
    const action: ActionLog = {
      id: randomUUID(),
      seq: game.actions.length + 1,
      round: game.currentRound,
      participantId: sorcerer.id,
      actionType: "item",
      fromPosition: sorcerer.position,
      toPosition: sorcerer.position,
      direction: null,
      crossedDoor: false,
      drank: false,
      skillId: pending.prophecyBallUsed
        ? "prophecy_ball"
        : "invisibility_cloak",
      skillTarget: {
        prophecyBallUsed: pending.prophecyBallUsed,
        invisibilityUsed: pending.invisibilityUsed,
      },
      killedParticipantIds: [],
      died: false,
      createdAt: now.toISOString(),
    };
    game.actions.push(action);
    actions.push(action);
    events.push(
      makeEvent(
        "item_used",
        {
          participantId: sorcerer.id,
          nickname: sorcerer.nickname,
          itemId: pending.prophecyBallUsed ? "prophecy_ball" : "invisibility_cloak",
          prophecyBallUsed: pending.prophecyBallUsed,
          invisibilityUsed: pending.invisibilityUsed,
        },
        { round: game.currentRound, actorParticipantId: sorcerer.id, now: now.toISOString() },
      ),
    );
  }

  events.push(
    makeEvent(
      "fog_resolved",
      {
        id: pending.id,
        casterParticipantId: pending.casterParticipantId,
        positions,
        viewerParticipantIds,
      },
      { round: game.currentRound, actorParticipantId: pending.casterParticipantId, now: now.toISOString() },
    ),
  );

  const followUpActions: ActionLog[] = [];
  if (!checkAndFinishGame(room, now, events)) {
    events.push(...advanceTurn(room, now, pending.casterParticipantId, followUpActions));
  }
  return { events, actions: [...actions, ...followUpActions] };
}

export function respondToFogVision(
  room: RoomState,
  userId: string,
  useProphecyBall: boolean,
  useInvisibility: boolean,
  now = new Date(),
): EngineResult {
  const pending = room.game?.pendingFogVision;
  if (!room.game || !pending) throw new Error("NO_FOG_DECISION");
  const game = room.game;
  const sorcerer = pending.sorcererParticipantId
    ? game.participants[pending.sorcererParticipantId]
    : null;
  if (!sorcerer || sorcerer.userId !== userId || !sorcerer.alive) {
    throw new Error("NOT_A_SORCERER");
  }
  if (pending.responded) throw new Error("FOG_DECISION_ALREADY_MADE");
  if (useInvisibility && !sorcerer.invisibilityCloakAvailable) {
    throw new Error("INVISIBILITY_UNAVAILABLE");
  }
  pending.prophecyBallUsed = useProphecyBall;
  pending.invisibilityUsed = useInvisibility;
  pending.responded = true;
  const result = resolvePendingFogVision(room, now);
  result.events.unshift(
    makeEvent(
      "fog_response",
      {
        participantId: sorcerer.id,
        nickname: sorcerer.nickname,
        useProphecyBall,
        useInvisibility,
      },
      { round: game.currentRound, actorParticipantId: sorcerer.id, now: now.toISOString() },
    ),
  );
  return result;
}

function heldBookForParticipant(
  game: GameState,
  participant: ParticipantState,
): BookState | null {
  return (
    participant.bookIds
      .map((bookId) => game.books[bookId])
      .find((book): book is BookState => Boolean(book)) ?? null
  );
}

export function throwBook(
  room: RoomState,
  userId: string,
  direction: Direction,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "playing") throw new Error("WRONG_PHASE");
  if (room.game.pendingFogVision) throw new Error("FOG_DECISION_PENDING");
  const game = room.game;
  const actor = currentTurnParticipant(game);
  if (!actor || actor.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (!actor.position || !ORTHOGONAL_DIRECTIONS.includes(direction)) {
    throw new Error("INVALID_BOOK_DIRECTION");
  }
  const book = heldBookForParticipant(game, actor);
  if (!book) throw new Error("BOOK_NOT_HELD");

  const from = { ...actor.position };
  let cursor = { ...from };
  let landing = { ...from };
  let hit: ParticipantState | null = null;
  for (let step = 0; step < 3; step += 1) {
    const next = destination(cursor, direction);
    if (!isPositionOnMap(game.map, next)) break;
    const fromSection = getSectionAt(game.map, cursor);
    const nextSection = getSectionAt(game.map, next);
    if (!fromSection || !nextSection || fromSection.id !== nextSection.id) break;
    cursor = next;
    landing = { ...next };
    hit =
      Object.values(game.participants).find(
        (participant) =>
          participant.alive &&
          participant.id !== actor.id &&
          samePosition(participant.position, next),
      ) ?? null;
    if (hit) break;
  }

  book.holderParticipantId = null;
  book.position = { ...landing };
  actor.bookIds = actor.bookIds.filter((bookId) => bookId !== book.id);
  const marker = {
    id: randomUUID(),
    throwerParticipantId: actor.id,
    position: { ...landing },
    active: true,
    createdAt: now.toISOString(),
  };
  book.throwerMarkers.push(marker);
  const events: EngineEvent[] = [
    makeEvent(
      "book_thrown",
      {
        bookId: book.id,
        participantId: actor.id,
        nickname: actor.nickname,
        from,
        to: { ...landing },
        direction,
        markerId: marker.id,
      },
      { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
    ),
  ];

  if (hit) {
    if (tryConsumeBackpack(game, hit, "ancient_book", events, now)) {
      pickupBook(game, book, hit, events, now);
    } else {
      actor.killCount += 1;
      events.push(...markDeath(game, hit, "book_impact", now, actor.id));
    }
  }

  actor.skillUseCount += 1;
  const action: ActionLog = {
    id: randomUUID(),
    seq: game.actions.length + 1,
    round: game.currentRound,
    participantId: actor.id,
    actionType: "item",
    fromPosition: from,
    toPosition: landing,
    direction,
    crossedDoor: false,
    drank: false,
    skillId: "ancient_book_throw",
    skillTarget: { bookId: book.id, heard: Boolean(hit) },
    killedParticipantIds: hit && !hit.alive ? [hit.id] : [],
    died: false,
    createdAt: now.toISOString(),
  };
  game.actions.push(action);

  if (checkAndFinishGame(room, now, events)) {
    return { events, actions: [action] };
  }
  const followUpActions: ActionLog[] = [];
  events.push(...advanceTurn(room, now, actor.id, followUpActions));
  return { events, actions: [action, ...followUpActions] };
}

export function readBook(
  room: RoomState,
  userId: string,
  targetParticipantId: string,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "playing") throw new Error("WRONG_PHASE");
  if (room.game.pendingFogVision) throw new Error("FOG_DECISION_PENDING");
  const game = room.game;
  const actor = currentTurnParticipant(game);
  if (!actor || actor.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (actor.roleId !== "archaeologist") throw new Error("NOT_ARCHAEOLOGIST");
  const target = game.participants[targetParticipantId];
  if (!target?.alive || !target.position || target.id === actor.id) {
    throw new Error("INVALID_READING_TARGET");
  }
  const book = actor.bookIds
    .map((bookId) => game.books[bookId])
    .find((candidate): candidate is BookState => Boolean(candidate && candidate.readsRemaining > 0));
  if (!book) throw new Error("NO_BOOK_READS");
  book.readsRemaining -= 1;
  const mark = {
    id: randomUUID(),
    ownerParticipantId: actor.id,
    targetParticipantId: target.id,
    roleId: target.roleId,
    position: { ...target.position },
    createdRound: game.currentRound,
    createdAt: now.toISOString(),
  };
  game.readingMarks[actor.id] = mark;
  actor.skillUseCount += 1;
  const events: EngineEvent[] = [
    makeEvent(
      "reading_marked",
      {
        ...mark,
        ownerNickname: actor.nickname,
        targetNickname: target.nickname,
      },
      { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
    ),
  ];
  const action: ActionLog = {
    id: randomUUID(),
    seq: game.actions.length + 1,
    round: game.currentRound,
    participantId: actor.id,
    actionType: "item",
    fromPosition: actor.position,
    toPosition: actor.position,
    direction: null,
    crossedDoor: false,
    drank: false,
    skillId: "ancient_book_read",
    skillTarget: { targetParticipantId: target.id, bookId: book.id },
    killedParticipantIds: [],
    died: false,
    createdAt: now.toISOString(),
  };
  game.actions.push(action);
  if (checkAndFinishGame(room, now, events)) {
    return { events, actions: [action] };
  }
  const followUpActions: ActionLog[] = [];
  events.push(...advanceTurn(room, now, actor.id, followUpActions));
  return { events, actions: [action, ...followUpActions] };
}

export function useSkill(
  room: RoomState,
  userId: string,
  skillId: SkillId,
  target: SkillUseTarget,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "playing") throw new Error("WRONG_PHASE");
  if (room.game.pendingFogVision) throw new Error("FOG_DECISION_PENDING");
  const game = room.game;
  const actor = currentTurnParticipant(game);
  if (!actor || actor.userId !== userId) throw new Error("NOT_YOUR_TURN");
  if (!actor.position) throw new Error("PLAYER_HAS_NO_POSITION");
  const skill = SKILL_REGISTRY[skillId];
  if (!skill || skill.roleId !== actor.roleId) throw new Error("UNKNOWN_SKILL");
  const unavailable = skillUnavailableReason(game, actor);
  if (unavailable) throw new Error("SKILL_UNAVAILABLE");

  const from = { ...actor.position };
  let finalPosition = { ...actor.position };
  let actorDied = false;
  const killedParticipantIds: string[] = [];
  const events: EngineEvent[] = [
    makeEvent(
      "skill_used",
      {
        participantId: actor.id,
        nickname: actor.nickname,
        skillId: skill.id,
        skillName: skill.name,
        position: from,
        target,
      },
      { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
    ),
  ];

  if (skillId === "thief_hook") {
    if (target.kind !== "cell" || !isPositionOnMap(game.map, target.position)) {
      throw new Error("INVALID_SKILL_TARGET");
    }
    const fromSection = getSectionAt(game.map, from);
    const targetSection = getSectionAt(game.map, target.position);
    if (
      !fromSection ||
      !targetSection ||
      fromSection.id !== targetSection.id ||
      positionsEqual(from, target.position)
    ) {
      throw new Error("INVALID_SKILL_TARGET");
    }
    actor.ammo = Math.max(0, actor.ammo - 1);
    actor.position = { ...target.position };
    syncHeldBooks(game, actor);
    actor.moveCount += 1;
    finalPosition = { ...target.position };
    const signal = {
      id: randomUUID(),
      participantId: actor.id,
      color: actor.color,
      from,
      to: { ...target.position },
      round: game.currentRound,
      createdAt: now.toISOString(),
    };
    game.hookSignals.push(signal);
    events.push(
      makeEvent(
        "hook_used",
        { signal },
        { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
      ),
    );
    applyPaintAfterMove(game, actor, from, target.position, events, now);
    const contact = resolveMovementContact(game, actor, target.position, events, now);
    actorDied = contact.actorDied;
    killedParticipantIds.push(...contact.killedParticipantIds);
    if (actor.alive) pickupBooksAtPosition(game, actor, events, now);
  } else if (skillId === "hunter_shoot") {
    // 子弹逐格检查 1~4 格，不检查普通门、锁定门或其他玩家阻挡。
    // 路径上所有仍存活玩家按命中顺序死亡，再统一执行后坐力。
    if (target.kind !== "direction" || !ORTHOGONAL_DIRECTIONS.includes(target.direction)) {
      throw new Error("INVALID_SKILL_TARGET");
    }
    actor.ammo = 0;
    game.gunshotSignals.push({ ...from });
    events.push(
      makeEvent(
        "gunshot",
        { participantId: actor.id, position: { ...from } },
        { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
      ),
    );

    let bulletPosition = { ...from };
    let bulletStopped = false;
    for (let step = 0; step < 4; step += 1) {
      bulletPosition = destination(bulletPosition, target.direction);
      if (!isPositionOnMap(game.map, bulletPosition)) break;
      const hitParticipants = Object.values(game.participants).filter(
        (participant) =>
          participant.alive &&
          participant.position?.x === bulletPosition.x &&
          participant.position?.y === bulletPosition.y,
      );
      for (const hit of hitParticipants) {
        if (tryConsumeBackpack(game, hit, "hunter_bullet", events, now)) {
          bulletStopped = true;
          break;
        }
        actor.killCount += 1;
        killedParticipantIds.push(hit.id);
        events.push(...markDeath(game, hit, "gunshot", now, actor.id));
      }
      if (bulletStopped) break;
    }

    const recoilDirection = OPPOSITE_DIRECTIONS[target.direction];
    const recoilTarget = destination(from, recoilDirection);
    const fromSection = getSectionAt(game.map, from);
    const targetSection = getSectionAt(game.map, recoilTarget);
    const canRecoil =
      isPositionOnMap(game.map, recoilTarget) &&
      fromSection?.id === targetSection?.id &&
      !isLockedConnection(game, from, recoilTarget);
    if (canRecoil) {
      actor.position = recoilTarget;
      syncHeldBooks(game, actor);
      actor.moveCount += 1;
      finalPosition = { ...recoilTarget };
      events.push(
        makeEvent(
          "actor_moved",
          {
            participantId: actor.id,
            userId: actor.userId,
            nickname: actor.nickname,
            from,
            to: recoilTarget,
            direction: recoilDirection,
            drank: false,
            automatic: true,
          },
          { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
        ),
      );
      applyPaintAfterMove(game, actor, from, recoilTarget, events, now);
      const contact = resolveMovementContact(game, actor, recoilTarget, events, now);
      actorDied = contact.actorDied;
      killedParticipantIds.push(...contact.killedParticipantIds);
      if (actor.alive) pickupBooksAtPosition(game, actor, events, now);
      if (targetSection?.type === "storage") actor.ammo = 1;
    }
  } else if (skillId === "conductor_lock") {
    // 锁门只登记连接处；不修改门两侧格子的可站立状态。
    const nearest = nearestConnectionForPosition(game.map, from);
    if (!nearest) throw new Error("INVALID_SKILL_TARGET");
    const ordered = orderedConnectionSections(
      game.map,
      nearest.split(":")[0]!,
      nearest.split(":")[1]!,
    );
    if (!ordered?.upper || !ordered.lower) throw new Error("INVALID_SKILL_TARGET");
    game.lockedDoors[nearest] = {
      connectionId: nearest,
      ownerParticipantId: actor.id,
      upperSectionId: ordered.upper.id,
      lowerSectionId: ordered.lower.id,
      remainingConductorTurns: 3,
    };
    actor.lockUsesRemaining -= 1;
    actor.lastLockRound = game.currentRound;
    events.push(
      makeEvent(
        "door_locked",
        {
          participantId: actor.id,
          nickname: actor.nickname,
          connectionId: nearest,
          remainingConductorTurns: 3,
        },
        { round: game.currentRound, actorParticipantId: actor.id, now: now.toISOString() },
      ),
    );
  } else if (skillId === "painter_paint") {
    if (target.kind !== "cell") throw new Error("INVALID_SKILL_TARGET");
    const dx = Math.abs(target.position.x - from.x);
    const dy = Math.abs(target.position.y - from.y);
    if (
      dx > 1 ||
      dy > 1 ||
      !isPositionOnMap(game.map, target.position)
    ) {
      throw new Error("INVALID_SKILL_TARGET");
    }
    actor.paintUsesRemaining -= 1;
    addPaint(game, target.position, events, now, "skill", actor.id);
  }

  actor.skillUseCount += 1;
  replenishThiefHook(game, actor);
  events.push(...tickConductorLocksAfterAction(game, actor.id, now));

  const action: ActionLog = {
    id: randomUUID(),
    seq: game.actions.length + 1,
    round: game.currentRound,
    participantId: actor.id,
    actionType: "skill",
    fromPosition: from,
    toPosition: finalPosition,
    direction: target.kind === "direction" ? target.direction : null,
    crossedDoor: false,
    drank: false,
    skillId,
    skillTarget: target,
    killedParticipantIds,
    died: actorDied,
    createdAt: now.toISOString(),
  };
  game.actions.push(action);

  if (!checkAndFinishGame(room, now, events)) {
    const followUpActions: ActionLog[] = [];
    events.push(...advanceTurn(room, now, actor.id, followUpActions));
    return { events, actions: [action, ...followUpActions] };
  }
  return { events, actions: [action] };
}

export function applyTurnTimeout(room: RoomState, now = new Date()): EngineResult {
  if (!room.game) return { events: [], actions: [] };
  if (room.phase === "role_select") return autoCompleteRoleSelection(room, now);
  if (room.phase === "placement") return autoCompleteCurrentPlacement(room, now);
  if (room.phase !== "playing") return { events: [], actions: [] };
  if (room.game.pendingFogVision) {
    room.game.pendingFogVision.responded = true;
    return resolvePendingFogVision(room, now);
  }
  const actor = currentTurnParticipant(room.game);
  if (!actor) return { events: [], actions: [] };
  const action: ActionLog = {
    id: randomUUID(),
    seq: room.game.actions.length + 1,
    round: room.game.currentRound,
    participantId: actor.id,
    actionType: "skip",
    fromPosition: actor.position,
    toPosition: actor.position,
    direction: null,
    crossedDoor: false,
    drank: false,
    skillId: null,
    skillTarget: null,
    killedParticipantIds: [],
    died: false,
    createdAt: now.toISOString(),
  };
  room.game.actions.push(action);
  replenishThiefHook(room.game, actor);
  const followUpActions: ActionLog[] = [];
  const events = [
    makeEvent(
      "activity",
      { actorParticipantId: actor.id, nickname: actor.nickname, reason: "turn_timeout" },
      { actorParticipantId: actor.id, round: room.game.currentRound, now: now.toISOString() },
    ),
    ...advanceTurn(room, now, actor.id, followUpActions),
  ];
  events.splice(
    1,
    0,
    ...tickConductorLocksAfterAction(room.game, actor.id, now),
  );
  return { events, actions: [action, ...followUpActions] };
}

export function finishBotOnlyGame(
  room: RoomState,
  userId: string,
  now = new Date(),
): EngineResult {
  if (!room.game || room.phase !== "playing") throw new Error("WRONG_PHASE");
  if (room.hostUserId !== userId) throw new Error("NOT_HOST");
  const alive = aliveParticipants(room.game);
  if (alive.length === 0 || alive.some((participant) => !participant.isBot)) {
    throw new Error("BOT_ONLY_REQUIRED");
  }
  return {
    events: finishGame(room, now, "host_bot_only"),
    actions: [],
  };
}

export function killParticipant(
  room: RoomState,
  participantId: string,
  reason: DeathReason,
  now = new Date(),
): EngineResult {
  if (!room.game) return { events: [], actions: [] };
  const participant = room.game.participants[participantId];
  if (!participant || !participant.alive) return { events: [], actions: [] };
  const wasCurrent = room.game.currentTurnParticipantId === participantId;
  const events = markDeath(room.game, participant, reason, now);
  const actions: ActionLog[] = [];

  if (checkAndFinishGame(room, now, events)) return { events, actions };

  if (room.phase === "placement") {
    const next = currentPlacementParticipant(room.game);
    room.game.currentTurnParticipantId = next?.id ?? null;
    room.game.deadlineAt = next
      ? new Date(now.getTime() + room.settings.turnTimeoutMs).toISOString()
      : null;
    if (!next) events.push(...startPlaying(room, now, actions));
    else if (wasCurrent) {
      events.push(
        makeEvent(
          "activity",
          {
            actorParticipantId: next.id,
            nickname: next.nickname,
            phase: "placement",
            deadlineAt: room.game.deadlineAt,
          },
          { actorParticipantId: next.id, now: now.toISOString() },
        ),
      );
    }
  } else if (room.phase === "playing" && wasCurrent) {
    events.push(...advanceTurn(room, now, null, actions));
  }
  return { events, actions };
}

function checkAndFinishGame(
  room: RoomState,
  now: Date,
  events: EngineEvent[],
): boolean {
  if (!room.game || room.game.phase === "finished") return true;
  const alive = aliveParticipants(room.game);
  const nonCorpseAlive = alive.filter((participant) => !isCorpse(participant));
  if (alive.length <= 1 || nonCorpseAlive.length === 0) {
    events.push(...finishGame(room, now));
    return true;
  }
  return false;
}

function finishWithoutSurvivors(room: RoomState, now: Date): EngineEvent[] {
  return finishGame(room, now);
}

function finishGame(
  room: RoomState,
  now: Date,
  endReason: "normal" | "host_bot_only" = "normal",
): EngineEvent[] {
  if (!room.game || room.game.phase === "finished") return [];
  room.game.phase = "finished";
  room.phase = "finished";
  room.finishedAt = now.toISOString();
  room.game.finishedAt = now.toISOString();
  room.game.currentTurnParticipantId = null;
  room.game.deadlineAt = null;
  room.game.fogViews = {};
  room.game.pendingFogVision = null;

  const alive = aliveParticipants(room.game);
  room.game.winnerParticipantIds = alive.map((participant) => participant.id);
  const deathRounds = [
    ...new Set(
      Object.values(room.game.participants)
        .filter((participant) => !participant.alive)
        .map((participant) => participant.deathRound ?? 0),
    ),
  ].sort((left, right) => right - left);

  for (const participant of Object.values(room.game.participants)) {
    participant.finalPosition = participant.position ? { ...participant.position } : null;
    if (participant.alive) {
      participant.finalRank = 1;
      participant.survivedRounds = room.game.completedRounds;
      continue;
    }
    const deathRound = participant.deathRound ?? 0;
    const laterDeaths = Object.values(room.game.participants).filter(
      (candidate) =>
        !candidate.alive && (candidate.deathRound ?? 0) > deathRound,
    ).length;
    participant.finalRank = 1 + alive.length + laterDeaths;
  }

  const leaderboard = getLeaderboard(room.game);
  return [
    makeEvent(
      "game_finished",
      {
        winnerParticipantIds: room.game.winnerParticipantIds,
        leaderboard,
        noUniqueWinner: alive.length === 0,
        endReason,
      },
      { now: now.toISOString() },
    ),
    makeEvent("replay_ready", { roomCode: room.code }, { now: now.toISOString() }),
  ];
}

export function getLeaderboard(game: GameState): PlayerResult[] {
  return Object.values(game.participants)
    .map((participant) => ({
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
    }))
    .sort((left, right) => {
      if (left.finalRank !== right.finalRank) return left.finalRank - right.finalRank;
      if (right.killCount !== left.killCount) return right.killCount - left.killCount;
      return left.nickname.localeCompare(right.nickname, "zh-CN");
    });
}
