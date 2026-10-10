/**
 * 规则引擎单元测试。
 *
 * 测试直接构造内存 RoomState，不启动 HTTP/Socket，便于精确验证边界规则：
 * 移动、喝水、挤压、锁门、白漆、猎人弹道和雾视可见性。
 */
import { describe, expect, it } from "vitest";
import {
  MAP_REGISTRY,
  ROLE_REGISTRY,
  createBoard,
  getVisibleSectionIds,
  isCarriageDoorCrossing,
} from "@fog-train/shared";
import {
  applyMove,
  applyTurnTimeout,
  choosePlacementCell,
  choosePlacementSection,
  chooseRole,
  createGame,
  currentPlacementParticipant,
  finishBotOnlyGame,
  findParticipantByUser,
  killParticipant,
  readBook,
  resolvePendingFogVision,
  respondToFogVision,
  startRoleSelection,
  throwBook,
  useFogVision,
  useSkill,
} from "./engine";
import { RoomService } from "../rooms/service";
import { BOT_NAME_POOL, chooseBotName, GOLDEN_BOT_NAME } from "../bots/names";
import type { MemberState, RoomState } from "../types";

function members(count: number): MemberState[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `user-${index}`,
    nickname: `玩家${index + 1}`,
    color: index === 0 ? "#e45756" : "#4c78a8",
    kind: "player",
    control: "active",
    ready: true,
    joinOrder: index,
    disconnectedAt: null,
    isBot: false,
    botDifficulty: null,
    isGoldenBot: false,
  }));
}

function roomWithPlayers(count: number): RoomState {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const room: RoomState = {
    version: 1,
    id: "room-1",
    code: "ABCDEF",
    mapId: "standard_train",
    hostUserId: "user-0",
    phase: "lobby",
    settings: {
      turnTimeoutMs: 60_000,
      reconnectGraceMs: 45_000,
      maxSpectators: 32,
    },
    initialPlayerCount: count,
    createdAt: now.toISOString(),
    startedAt: null,
    finishedAt: null,
    closedAt: null,
    seq: 0,
    members: members(count),
    messages: [],
    game: null,
    processedCommands: {},
  };
  room.game = createGame(room.id, room.members, now);
  startRoleSelection(room, now);
  return room;
}

function completePlacement(room: RoomState): void {
  let guard = 0;
  while (room.phase === "placement" && guard < 20) {
    guard += 1;
    const participant = currentPlacementParticipant(room.game!);
    if (!participant) break;
    if (participant.roleId === "conductor") {
      const engine = room.game!.map.sections.find((section) => section.type === "engine")!;
      choosePlacementCell(room, participant.userId, {
        x: 1,
        y: engine.startY,
      });
      continue;
    }
    const section = room
      .game!.map.sections.find(
        (candidate) =>
          candidate.type === "carriage" &&
          !Object.values(room.game!.participants).some(
            (candidateParticipant) =>
              candidateParticipant.id !== participant.id &&
              candidateParticipant.placedSectionId === candidate.id,
          ),
      )!;
    choosePlacementSection(room, participant.userId, section.id);
    choosePlacementCell(room, participant.userId, {
      x: 1,
      y: section.startY + 1,
    });
  }
}

describe("board rules", () => {
  it("creates 3-column train sections and detects only carriage door crossings", () => {
    const map = createBoard(3);
    expect(map.columns).toBe(3);
    expect(map.rows).toBe(2 + 3 * 4 + 2);
    expect(map.sections.map((section) => section.type)).toEqual([
      "engine",
      "carriage",
      "carriage",
      "carriage",
      "storage",
    ]);
    expect(isCarriageDoorCrossing(map, { x: 1, y: 5 }, { x: 1, y: 6 })).toBe(true);
    expect(isCarriageDoorCrossing(map, { x: 1, y: 1 }, { x: 1, y: 2 })).toBe(false);
    expect(isCarriageDoorCrossing(map, { x: 0, y: 5 }, { x: 1, y: 6 })).toBe(true);
  });

  it("limits living-player views to three adjacent sections and clamps the endpoints", () => {
    const map = createBoard(3);
    expect(getVisibleSectionIds(map, { x: 1, y: 0 })).toEqual([
      "engine",
      "carriage-0",
    ]);
    expect(getVisibleSectionIds(map, { x: 1, y: 7 })).toEqual([
      "carriage-0",
      "carriage-1",
      "carriage-2",
    ]);
    expect(getVisibleSectionIds(map, { x: 1, y: 14 })).toEqual([
      "carriage-2",
      "storage",
    ]);
  });

  it("keeps map placeholders discoverable without enabling unfinished builders", () => {
    expect(MAP_REGISTRY.standard_train.available).toBe(true);
    expect(MAP_REGISTRY.luxury_train.available).toBe(false);
    expect(MAP_REGISTRY.fog_village.available).toBe(false);
    expect(() => createBoard(3, "luxury_train")).toThrow(
      "MAP_NOT_IMPLEMENTED:luxury_train",
    );
  });
});

describe("game engine", () => {
  it("uses a unique 2015+ female-character name pool and reserves the golden exception", () => {
    expect(BOT_NAME_POOL).toHaveLength(30);
    expect(BOT_NAME_POOL).not.toContain(GOLDEN_BOT_NAME);
    const used = new Set<string>();
    const picked: string[] = [];
    for (let index = 0; index < BOT_NAME_POOL.length + 1; index += 1) {
      const name = chooseBotName(used);
      expect(used.has(name)).toBe(false);
      used.add(name);
      picked.push(name);
    }
    expect(picked).toContain(GOLDEN_BOT_NAME);
    expect(() => chooseBotName(used)).toThrow("BOT_NAMES_EXHAUSTED");
  });

  it("adds and removes bot members with automatic readiness", async () => {
    const room = roomWithPlayers(1);
    room.phase = "lobby";
    room.game = null;
    room.initialPlayerCount = 0;
    const service = new RoomService(room.settings, () => undefined);
    await service.addBot(room, "user-0", "standard");
    expect(room.members).toHaveLength(2);
    expect(room.members[1]).toMatchObject({
      kind: "player",
      ready: true,
      isBot: true,
      botDifficulty: "standard",
    });
    await service.removeBot(room, "user-0", room.members[1]!.userId);
    expect(room.members).toHaveLength(1);
  });

  it("publishes locked role placeholders but rejects selecting them", () => {
    const room = roomWithPlayers(2);
    expect(Object.values(ROLE_REGISTRY)).toHaveLength(19);
    expect(ROLE_REGISTRY.thief.available).toBe(true);
    expect(ROLE_REGISTRY.corpse.available).toBe(true);
    expect(ROLE_REGISTRY.bug.available).toBe(true);
    expect(ROLE_REGISTRY.merchant.available).toBe(false);
    expect(ROLE_REGISTRY.merchant.requiredMapId).toBe("luxury_train");
  });

  it("selects roles, places all players, and starts round one", () => {
    const room = roomWithPlayers(2);
    for (const member of room.members) {
      chooseRole(room, member.userId, "unlucky");
    }
    expect(room.phase).toBe("placement");
    completePlacement(room);
    expect(room.phase).toBe("playing");
    expect(room.game?.currentRound).toBe(1);
    expect(room.game?.participants).toBeDefined();
    expect(
      Object.values(room.game!.participants).every(
        (participant) => participant.position && participant.initialPosition,
      ),
    ).toBe(true);
  });

  it("resets thirst on a carriage door and kills on squeeze", () => {
    const room = roomWithPlayers(2);
    for (const member of room.members) chooseRole(room, member.userId, "unlucky");
    completePlacement(room);
    const game = room.game!;
    const first = game.participants[game.participantOrder[0]!]!;
    const second = game.participants[game.participantOrder[1]!]!;
    first.position = { x: 0, y: 5 };
    second.position = { x: 1, y: 7 };
    first.waterCountdown = 2;
    game.currentTurnIndex = 0;
    game.currentTurnParticipantId = first.id;

    applyMove(room, first.userId, "down");
    expect(first.waterCountdown).toBe(9);
    expect(first.waterCount).toBe(1);
    expect(first.drankThisRound).toBe(true);

    game.currentTurnIndex = 0;
    game.currentTurnParticipantId = first.id;
    applyMove(room, first.userId, "down_right");
    expect(second.alive).toBe(false);
    expect(second.deathReason).toBe("squeeze");
    expect(first.killCount).toBe(1);
    expect(game.phase).toBe("finished");
    expect(first!.finalRank).toBe(1);
  });

  it("skips a timed out turn without killing the player", () => {
    const room = roomWithPlayers(2);
    for (const member of room.members) chooseRole(room, member.userId, "unlucky");
    completePlacement(room);
    const actor = room.game!.participants[room.game!.currentTurnParticipantId!]!;
    const before = actor.moveCount;
    applyTurnTimeout(room);
    expect(actor.moveCount).toBe(before);
    expect(actor.alive).toBe(true);
    expect(room.game?.actions.at(-1)?.actionType).toBe("skip");
  });

  it("hunter bullets pierce the train, kill multiple players, and recoil once", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "hunter");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const hunter = findParticipantByUser(game, "user-0")!;
    const targets = [
      findParticipantByUser(game, "user-1")!,
      findParticipantByUser(game, "user-2")!,
    ];
    hunter.position = { x: 1, y: 10 };
    targets[0]!.position = { x: 1, y: 9 };
    targets[1]!.position = { x: 1, y: 8 };
    game.currentTurnIndex = game.participantOrder.indexOf(hunter.id);
    game.currentTurnParticipantId = hunter.id;

    const result = useSkill(room, hunter.userId, "hunter_shoot", {
      kind: "direction",
      direction: "up",
    });
    expect(targets.every((participant) => !participant.alive)).toBe(true);
    expect(hunter.killCount).toBe(2);
    expect(hunter.ammo).toBe(0);
    expect(hunter.position).toEqual({ x: 1, y: 11 });
    expect(game.gunshotSignals).toContainEqual({ x: 1, y: 10 });
    expect(result.events.filter((event) => event.type === "death")).toHaveLength(2);
  });

  it("conductor locks a connection and blocks cross-section movement", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "conductor");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const conductor = findParticipantByUser(game, "user-0")!;
    const mover = findParticipantByUser(game, "user-1")!;
    conductor.position = { x: 1, y: 1 };
    mover.position = { x: 1, y: 2 };
    game.currentTurnIndex = game.participantOrder.indexOf(conductor.id);
    game.currentTurnParticipantId = conductor.id;
    const result = useSkill(room, conductor.userId, "conductor_lock", { kind: "none" });
    expect(result.events.some((event) => event.type === "door_locked")).toBe(true);
    expect(conductor.lockUsesRemaining).toBe(1);
    expect(Object.keys(game.lockedDoors)).toHaveLength(1);

    game.currentTurnIndex = game.participantOrder.indexOf(mover.id);
    game.currentTurnParticipantId = mover.id;
    expect(() => applyMove(room, mover.userId, "up")).toThrow("DOOR_LOCKED");
    applyMove(room, mover.userId, "down");
    expect(mover.position).toEqual({ x: 1, y: 3 });
  });

  it("allows only one conductor in a game", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "conductor");
    expect(() => chooseRole(room, "user-1", "conductor")).toThrow(
      "CONDUCTOR_ALREADY_SELECTED",
    );
  });

  it("fog vision waits for resolution and keeps anonymous positions for its viewer", () => {
    const room = roomWithPlayers(3);
    for (const member of room.members) chooseRole(room, member.userId, "unlucky");
    completePlacement(room);
    const game = room.game!;
    const viewer = game.participants[game.participantOrder[0]!]!;
    game.currentTurnIndex = 0;
    game.currentTurnParticipantId = viewer.id;
    useFogVision(room, viewer.userId);
    expect(viewer.fogVisionUsesRemaining).toBe(2);
    expect(game.pendingFogVision).not.toBeNull();
    expect(
      new Date(game.pendingFogVision!.deadlineAt).getTime() -
        new Date(game.pendingFogVision!.createdAt).getTime(),
    ).toBe(1_000);
    expect(game.fogViews[viewer.id]).toBeUndefined();
    resolvePendingFogVision(room);
    expect(game.fogViews[viewer.id]?.positions).toHaveLength(2);
    expect(game.fogViews[viewer.id]?.positions).not.toContainEqual(viewer.position);

    const service = new RoomService(room.settings, () => undefined);
    room.members.push({
      userId: "watcher",
      nickname: "观战者",
      color: "#eeca3b",
      kind: "spectator",
      control: "active",
      ready: false,
      joinOrder: 3,
      disconnectedAt: null,
      isBot: false,
      botDifficulty: null,
      isGoldenBot: false,
    });
    const viewerSnapshot = service.buildSnapshot(room, viewer.userId);
    const otherSnapshot = service.buildSnapshot(
      room,
      game.participants[game.participantOrder[1]!]!.userId,
    );
    expect(viewerSnapshot.self?.fogVision.revealedPositions).toHaveLength(1);
    expect(viewerSnapshot.self?.visibleSectionIds).toHaveLength(3);
    expect(
      viewerSnapshot.self?.fogVision.sectionHints.reduce(
        (total, hint) => total + hint.count,
        0,
      ),
    ).toBe(1);
    expect(viewerSnapshot.self?.fogVision.sectionHints[0]).toMatchObject({
      direction: "below",
      sectionLabel: "车厢 3",
      count: 1,
    });
    expect(otherSnapshot.self?.fogVision.revealedPositions).toHaveLength(0);
    expect(JSON.stringify(viewerSnapshot)).not.toContain(
      JSON.stringify(game.participants[game.participantOrder[2]!]!.position),
    );

    const next = game.participants[game.participantOrder[1]!]!;
    game.currentTurnIndex = 1;
    game.currentTurnParticipantId = next.id;
    applyTurnTimeout(room);
    expect(game.fogViews[viewer.id]?.positions).toHaveLength(2);
  });

  it("keeps a fog result until the same player starts another fog vision", () => {
    const room = roomWithPlayers(2);
    for (const member of room.members) chooseRole(room, member.userId, "unlucky");
    completePlacement(room);
    const game = room.game!;
    const caster = game.participants[game.participantOrder[0]!]!;
    const other = game.participants[game.participantOrder[1]!]!;
    game.currentTurnIndex = 0;
    game.currentTurnParticipantId = caster.id;
    useFogVision(room, caster.userId);
    resolvePendingFogVision(room);
    const firstResultId = game.fogViews[caster.id]?.id;

    game.currentTurnIndex = 1;
    game.currentTurnParticipantId = other.id;
    applyTurnTimeout(room);
    expect(game.fogViews[caster.id]?.id).toBe(firstResultId);

    game.currentRound += 1;
    game.currentTurnIndex = 0;
    game.currentTurnParticipantId = caster.id;
    useFogVision(room, caster.userId);
    resolvePendingFogVision(room);
    expect(game.fogViews[caster.id]?.id).not.toBe(firstResultId);
  });

  it("painter paint spreads when another player enters the painted tile", () => {
    const room = roomWithPlayers(2);
    chooseRole(room, "user-0", "painter");
    chooseRole(room, "user-1", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const painter = findParticipantByUser(game, "user-0")!;
    const walker = findParticipantByUser(game, "user-1")!;
    expect(painter.paintUsesRemaining).toBe(3);
    painter.position = { x: 0, y: 3 };
    walker.position = { x: 0, y: 3 };
    game.currentTurnIndex = game.participantOrder.indexOf(painter.id);
    game.currentTurnParticipantId = painter.id;
    useSkill(room, painter.userId, "painter_paint", {
      kind: "cell",
      position: { x: 1, y: 3 },
    });
    expect(painter.paintUsesRemaining).toBe(2);

    game.currentTurnIndex = game.participantOrder.indexOf(walker.id);
    game.currentTurnParticipantId = walker.id;
    applyMove(room, walker.userId, "right");
    expect(walker.paintSpreadRoundsRemaining).toBeGreaterThanOrEqual(2);
    expect(game.paintTiles).toEqual(
      expect.arrayContaining([
        { x: 1, y: 3 },
      ]),
    );
    expect(game.paintTiles).not.toContainEqual({ x: 0, y: 3 });
  });

  it("does not refresh paint spread indefinitely from the player's own previous tile", () => {
    const room = roomWithPlayers(2);
    chooseRole(room, "user-0", "painter");
    chooseRole(room, "user-1", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const walker = findParticipantByUser(game, "user-1")!;
    game.currentRound = 3;
    walker.position = { x: 1, y: 3 };
    walker.paintSpreadRoundsRemaining = 0;
    game.paintTiles = [{ x: 1, y: 3 }];
    game.paintTileMeta["1:3"] = {
      createdRound: 2,
      creatorParticipantId: walker.id,
      source: "spread",
    };
    game.currentTurnIndex = game.participantOrder.indexOf(walker.id);
    game.currentTurnParticipantId = walker.id;
    applyMove(room, walker.userId, "right");
    expect(walker.paintSpreadRoundsRemaining).toBe(0);
    expect(game.paintTiles).not.toContainEqual({ x: 2, y: 3 });
  });

  it("lets the painter spread twice after painting directly under themselves", () => {
    const room = roomWithPlayers(2);
    chooseRole(room, "user-0", "painter");
    chooseRole(room, "user-1", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const painter = findParticipantByUser(game, "user-0")!;
    painter.position = { x: 0, y: 3 };
    game.currentTurnIndex = game.participantOrder.indexOf(painter.id);
    game.currentTurnParticipantId = painter.id;
    useSkill(room, painter.userId, "painter_paint", {
      kind: "cell",
      position: { x: 0, y: 3 },
    });
    applyTurnTimeout(room);
    expect(painter.paintSpreadRoundsRemaining).toBe(2);
  });

  it("hooks within one section, squeezes the landing target, and records a public signal", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "thief");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const thief = findParticipantByUser(game, "user-0")!;
    const target = findParticipantByUser(game, "user-1")!;
    thief.position = { x: 0, y: 2 };
    target.position = { x: 2, y: 5 };
    game.currentTurnIndex = game.participantOrder.indexOf(thief.id);
    game.currentTurnParticipantId = thief.id;

    const result = useSkill(room, thief.userId, "thief_hook", {
      kind: "cell",
      position: { x: 2, y: 5 },
    });
    expect(thief.position).toEqual({ x: 2, y: 5 });
    expect(target.alive).toBe(false);
    expect(target.deathReason).toBe("squeeze");
    expect(thief.killCount).toBe(1);
    expect(thief.moveCount).toBe(1);
    expect(thief.skillUseCount).toBe(1);
    expect(thief.ammo).toBe(0);
    expect(game.hookSignals).toHaveLength(1);
    expect(result.events.some((event) => event.type === "hook_used")).toBe(true);
  });

  it("rejects hooking to another section or the current cell and replenishes in storage", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "thief");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const thief = findParticipantByUser(game, "user-0")!;
    thief.position = { x: 0, y: 2 };
    game.currentTurnIndex = game.participantOrder.indexOf(thief.id);
    game.currentTurnParticipantId = thief.id;

    expect(() =>
      useSkill(room, thief.userId, "thief_hook", {
        kind: "cell",
        position: { x: 0, y: 2 },
      }),
    ).toThrow("INVALID_SKILL_TARGET");
    expect(() =>
      useSkill(room, thief.userId, "thief_hook", {
        kind: "cell",
        position: { x: 0, y: 6 },
      }),
    ).toThrow("INVALID_SKILL_TARGET");

    thief.position = { x: 0, y: 14 };
    thief.ammo = 0;
    applyTurnTimeout(room);
    expect(thief.ammo).toBe(1);
  });

  it("auto-skips corpses each round while preserving a skip action log", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "corpse");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const corpse = findParticipantByUser(game, "user-0")!;

    expect(game.currentTurnParticipantId).not.toBe(corpse.id);
    for (let index = 0; index < 4; index += 1) {
      if (
        game.actions.some(
          (action) =>
            action.participantId === corpse.id &&
            action.actionType === "skip" &&
            (action.skillTarget as { reason?: string } | null)?.reason ===
              "corpse_auto_skip",
        )
      ) {
        break;
      }
      applyTurnTimeout(room);
    }
    expect(
      game.actions.some(
        (action) =>
          action.participantId === corpse.id &&
          action.actionType === "skip" &&
          (action.skillTarget as { reason?: string } | null)?.reason === "corpse_auto_skip",
      ),
    ).toBe(true);
  });

  it("lets a hunter shoot a corpse but never makes the corpse thirsty", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "hunter");
    chooseRole(room, "user-1", "corpse");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const hunter = findParticipantByUser(game, "user-0")!;
    const corpse = findParticipantByUser(game, "user-1")!;
    hunter.position = { x: 1, y: 10 };
    corpse.position = { x: 1, y: 9 };
    corpse.waterCountdown = 0;
    game.currentTurnIndex = game.participantOrder.indexOf(hunter.id);
    game.currentTurnParticipantId = hunter.id;

    useSkill(room, hunter.userId, "hunter_shoot", {
      kind: "direction",
      direction: "up",
    });
    expect(corpse.alive).toBe(false);
    expect(corpse.deathReason).toBe("gunshot");
  });

  it("keeps a corpse alive through round-end thirst settlement", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "corpse");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const corpse = findParticipantByUser(game, "user-0")!;
    corpse.waterCountdown = 0;
    for (let index = 0; index < 6 && game.completedRounds === 0; index += 1) {
      applyTurnTimeout(room);
    }
    expect(game.completedRounds).toBeGreaterThanOrEqual(1);
    expect(corpse.alive).toBe(true);
    expect(corpse.waterCountdown).toBe(0);
  });

  it("resolves Bug contact in both directions without awarding kills", () => {
    const bugMovesRoom = roomWithPlayers(3);
    chooseRole(bugMovesRoom, "user-0", "bug");
    chooseRole(bugMovesRoom, "user-1", "unlucky");
    chooseRole(bugMovesRoom, "user-2", "unlucky");
    completePlacement(bugMovesRoom);
    const bugMovesGame = bugMovesRoom.game!;
    const bug = findParticipantByUser(bugMovesGame, "user-0")!;
    const target = findParticipantByUser(bugMovesGame, "user-1")!;
    bug.position = { x: 1, y: 3 };
    target.position = { x: 1, y: 4 };
    bugMovesGame.currentTurnIndex = bugMovesGame.participantOrder.indexOf(bug.id);
    bugMovesGame.currentTurnParticipantId = bug.id;
    applyMove(bugMovesRoom, bug.userId, "down");
    expect(bug.alive).toBe(false);
    expect(bug.deathReason).toBe("bug_contact");
    expect(bug.finalPosition).toEqual({ x: 1, y: 4 });
    expect(target.alive).toBe(true);
    expect(target.killCount).toBe(0);
    expect(bug.killCount).toBe(0);

    const playerMovesRoom = roomWithPlayers(3);
    chooseRole(playerMovesRoom, "user-0", "bug");
    chooseRole(playerMovesRoom, "user-1", "unlucky");
    chooseRole(playerMovesRoom, "user-2", "unlucky");
    completePlacement(playerMovesRoom);
    const playerMovesGame = playerMovesRoom.game!;
    const stationaryBug = findParticipantByUser(playerMovesGame, "user-0")!;
    const mover = findParticipantByUser(playerMovesGame, "user-1")!;
    stationaryBug.position = { x: 1, y: 4 };
    mover.position = { x: 1, y: 3 };
    playerMovesGame.currentTurnIndex = playerMovesGame.participantOrder.indexOf(mover.id);
    playerMovesGame.currentTurnParticipantId = mover.id;
    applyMove(playerMovesRoom, mover.userId, "down");
    expect(mover.alive).toBe(false);
    expect(mover.deathReason).toBe("bug_contact");
    expect(stationaryBug.alive).toBe(true);
    expect(stationaryBug.killCount).toBe(0);
  });

  it("gives Bug contact priority over corpse stepping", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "bug");
    chooseRole(room, "user-1", "corpse");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const bug = findParticipantByUser(game, "user-0")!;
    const corpse = findParticipantByUser(game, "user-1")!;
    bug.position = { x: 1, y: 3 };
    corpse.position = { x: 1, y: 4 };
    game.currentTurnIndex = game.participantOrder.indexOf(bug.id);
    game.currentTurnParticipantId = bug.id;
    applyMove(room, bug.userId, "down");
    expect(bug.alive).toBe(false);
    expect(corpse.alive).toBe(true);
    expect(bug.deathReason).toBe("bug_contact");
  });

  it("kills a thief who hooks onto Bug without crediting a kill", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "thief");
    chooseRole(room, "user-1", "bug");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const thief = findParticipantByUser(game, "user-0")!;
    const bug = findParticipantByUser(game, "user-1")!;
    thief.position = { x: 0, y: 2 };
    bug.position = { x: 2, y: 5 };
    game.currentTurnIndex = game.participantOrder.indexOf(thief.id);
    game.currentTurnParticipantId = thief.id;
    useSkill(room, thief.userId, "thief_hook", {
      kind: "cell",
      position: { x: 2, y: 5 },
    });
    expect(thief.alive).toBe(false);
    expect(thief.deathReason).toBe("bug_contact");
    expect(bug.alive).toBe(true);
    expect(bug.killCount).toBe(0);
  });

  it("ends with all remaining corpses tied as winners", () => {
    const room = roomWithPlayers(2);
    chooseRole(room, "user-0", "corpse");
    chooseRole(room, "user-1", "corpse");
    completePlacement(room);
    expect(room.phase).toBe("finished");
    expect(room.game!.winnerParticipantIds).toHaveLength(2);
    expect(
      Object.values(room.game!.participants).every(
        (participant) => participant.finalRank === 1,
      ),
    ).toBe(true);
  });

  it("gives the traveler 13 thirst and lets the backpack stop one item attack", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "hunter");
    chooseRole(room, "user-1", "traveler");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const hunter = findParticipantByUser(game, "user-0")!;
    const traveler = findParticipantByUser(game, "user-1")!;
    const behind = findParticipantByUser(game, "user-2")!;
    expect(traveler.waterCountdown).toBe(13);
    traveler.waterCountdown = 4;
    traveler.position = { x: 1, y: 5 };
    const firstCarriage = game.map.sections.find((section) => section.type === "carriage")!;
    traveler.position = { x: 1, y: firstCarriage.startY + 3 };
    hunter.position = { x: 1, y: firstCarriage.startY + 2 };
    behind.position = { x: 0, y: firstCarriage.startY + 1 };
    game.currentTurnIndex = game.participantOrder.indexOf(hunter.id);
    game.currentTurnParticipantId = hunter.id;
    useSkill(room, hunter.userId, "hunter_shoot", {
      kind: "direction",
      direction: "down",
    });
    expect(traveler.alive).toBe(true);
    expect(traveler.hasBackpack).toBe(false);
    expect(behind.alive).toBe(true);
    expect(hunter.killCount).toBe(0);

    traveler.position = { x: 1, y: firstCarriage.endY };
    game.currentTurnIndex = game.participantOrder.indexOf(traveler.id);
    game.currentTurnParticipantId = traveler.id;
    applyMove(room, traveler.userId, "down");
    expect(traveler.waterCountdown).toBe(13);
  });

  it("throws the ancient book, stops at the first player, and supports private marker clearing", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "archaeologist");
    chooseRole(room, "user-1", "traveler");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const archaeologist = findParticipantByUser(game, "user-0")!;
    const traveler = findParticipantByUser(game, "user-1")!;
    archaeologist.position = { x: 1, y: 3 };
    traveler.position = { x: 1, y: 4 };
    game.currentTurnIndex = game.participantOrder.indexOf(archaeologist.id);
    game.currentTurnParticipantId = archaeologist.id;
    const bookId = archaeologist.bookIds[0]!;
    const book = game.books[bookId]!;
    const result = throwBook(room, archaeologist.userId, "down");
    expect(result.events.some((event) => event.type === "book_thrown")).toBe(true);
    expect(traveler.alive).toBe(true);
    expect(traveler.hasBackpack).toBe(false);
    expect(book.holderParticipantId).toBe(traveler.id);
    expect(book.position).toEqual({ x: 1, y: 4 });
    expect(book.throwerMarkers[0]?.active).toBe(true);

    traveler.position = { x: 1, y: 4 };
    archaeologist.position = { x: 1, y: 3 };
    game.currentTurnIndex = game.participantOrder.indexOf(archaeologist.id);
    game.currentTurnParticipantId = archaeologist.id;
    applyMove(room, archaeologist.userId, "down");
    expect(book.holderParticipantId).toBe(archaeologist.id);
    expect(book.throwerMarkers[0]?.active).toBe(false);
  });

  it("lets only an archaeologist read a held book and keeps a fixed private snapshot", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "archaeologist");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const archaeologist = findParticipantByUser(game, "user-0")!;
    const target = findParticipantByUser(game, "user-1")!;
    game.currentTurnIndex = game.participantOrder.indexOf(archaeologist.id);
    game.currentTurnParticipantId = archaeologist.id;
    target.position = { x: 2, y: 5 };
    readBook(room, archaeologist.userId, target.id);
    const mark = game.readingMarks[archaeologist.id]!;
    expect(mark.targetParticipantId).toBe(target.id);
    expect(mark.position).toEqual({ x: 2, y: 5 });
    expect(game.books[archaeologist.bookIds[0]!]!.readsRemaining).toBe(2);
    target.position = { x: 0, y: 2 };
    expect(game.readingMarks[archaeologist.id]!.position).toEqual({ x: 2, y: 5 });
  });

  it("drops a held book on death and lets the occupying killer pick it up", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "archaeologist");
    chooseRole(room, "user-1", "unlucky");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const archaeologist = findParticipantByUser(game, "user-0")!;
    const killer = findParticipantByUser(game, "user-1")!;
    const bookId = archaeologist.bookIds[0]!;
    archaeologist.position = { x: 1, y: 3 };
    killer.position = { x: 1, y: 2 };
    game.books[bookId]!.position = { x: 1, y: 3 };
    game.currentTurnIndex = game.participantOrder.indexOf(killer.id);
    game.currentTurnParticipantId = killer.id;
    applyMove(room, killer.userId, "down");
    expect(archaeologist.alive).toBe(false);
    expect(game.books[bookId]!.holderParticipantId).toBe(killer.id);
    expect(killer.bookIds).toContain(bookId);
  });

  it("requires the sorcerer to respond before publishing anonymous fog positions", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "unlucky");
    chooseRole(room, "user-1", "sorcerer");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const caster = findParticipantByUser(game, "user-0")!;
    const sorcerer = findParticipantByUser(game, "user-1")!;
    game.currentTurnIndex = game.participantOrder.indexOf(caster.id);
    game.currentTurnParticipantId = caster.id;
    useFogVision(room, caster.userId);
    expect(game.pendingFogVision?.sorcererParticipantId).toBe(sorcerer.id);
    expect(
      new Date(game.pendingFogVision!.deadlineAt).getTime() -
        new Date(game.pendingFogVision!.createdAt).getTime(),
    ).toBe(10_000);
    expect(game.fogViews[caster.id]).toBeUndefined();
    respondToFogVision(room, sorcerer.userId, true, true);
    expect(game.fogViews[caster.id]?.positions).toHaveLength(1);
    expect(game.fogViews[sorcerer.id]?.id).toBe(game.fogViews[caster.id]?.id);
    expect(sorcerer.invisibilityCloakAvailable).toBe(false);
    expect(sorcerer.skillUseCount).toBe(1);
  });

  it("keeps a sorcerer prophecy result until a newer prophecy result arrives", () => {
    const room = roomWithPlayers(3);
    chooseRole(room, "user-0", "unlucky");
    chooseRole(room, "user-1", "sorcerer");
    chooseRole(room, "user-2", "unlucky");
    completePlacement(room);
    const game = room.game!;
    const firstCaster = findParticipantByUser(game, "user-0")!;
    const sorcerer = findParticipantByUser(game, "user-1")!;
    const secondCaster = findParticipantByUser(game, "user-2")!;

    game.currentTurnIndex = game.participantOrder.indexOf(firstCaster.id);
    game.currentTurnParticipantId = firstCaster.id;
    useFogVision(room, firstCaster.userId);
    respondToFogVision(room, sorcerer.userId, true, false);
    const firstProphecyId = game.fogViews[sorcerer.id]?.id;

    game.currentRound += 1;
    game.currentTurnIndex = game.participantOrder.indexOf(secondCaster.id);
    game.currentTurnParticipantId = secondCaster.id;
    useFogVision(room, secondCaster.userId);
    respondToFogVision(room, sorcerer.userId, false, false);
    expect(game.fogViews[sorcerer.id]?.id).toBe(firstProphecyId);

    game.currentRound += 1;
    game.currentTurnIndex = game.participantOrder.indexOf(firstCaster.id);
    game.currentTurnParticipantId = firstCaster.id;
    useFogVision(room, firstCaster.userId);
    respondToFogVision(room, sorcerer.userId, true, false);
    expect(game.fogViews[sorcerer.id]?.id).not.toBe(firstProphecyId);
  });

  it("lets the host finish only when the remaining living participants are bots", () => {
    const room = roomWithPlayers(3);
    for (const member of room.members) chooseRole(room, member.userId, "unlucky");
    completePlacement(room);
    const game = room.game!;
    const host = findParticipantByUser(game, "user-0")!;
    const firstBot = findParticipantByUser(game, "user-1")!;
    const secondBot = findParticipantByUser(game, "user-2")!;
    firstBot.isBot = true;
    secondBot.isBot = true;
    killParticipant(room, host.id, "voluntary_exit");

    const service = new RoomService(room.settings, () => undefined);
    expect(service.buildSnapshot(room, "user-0").canEndBotOnlyGame).toBe(true);
    expect(() => finishBotOnlyGame(room, "user-1")).toThrow("NOT_HOST");
    const result = finishBotOnlyGame(room, "user-0");
    expect(game.phase).toBe("finished");
    expect(firstBot.finalRank).toBe(1);
    expect(secondBot.finalRank).toBe(1);
    expect(
      result.events.some((event) => event.payload.endReason === "host_bot_only"),
    ).toBe(true);
  });
});

describe("visibility projection", () => {
  it("withholds opponents from living players and shows all to spectators", () => {
    const room = roomWithPlayers(2);
    for (const member of room.members) chooseRole(room, member.userId, "unlucky");
    completePlacement(room);
    room.members.push({
      userId: "watcher",
      nickname: "观战者",
      color: "#eeca3b",
      kind: "spectator",
      control: "active",
      ready: false,
      joinOrder: 2,
      disconnectedAt: null,
      isBot: false,
      botDifficulty: null,
      isGoldenBot: false,
    });
    const service = new RoomService(room.settings, () => undefined);
    const livingView = service.buildSnapshot(room, "user-0");
    const spectatorView = service.buildSnapshot(room, "watcher");
    const hiddenPosition = Object.values(room.game!.participants).find(
      (participant) => participant.userId === "user-1",
    )!.position!;

    expect(livingView.players).toBeUndefined();
    expect(livingView.self?.position).toBeTruthy();
    expect(spectatorView.players).toHaveLength(2);
    expect(JSON.stringify(livingView)).not.toContain(JSON.stringify(hiddenPosition));
  });
});
