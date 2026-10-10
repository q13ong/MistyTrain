import { randomInt } from "node:crypto";
import {
  ROLE_REGISTRY,
  SKILL_REGISTRY,
  getSectionAt,
  positionsInSection,
  type Direction,
  type Position,
  type RoleId,
  type SkillId,
  type SkillUseTarget,
} from "@fog-train/shared";
import {
  aliveParticipants,
  currentPlacementParticipant,
  currentTurnParticipant,
  findParticipantByUser,
  fogVisionUnavailableReason,
  legalMovementDirections,
  skillUnavailableReason,
} from "../game/engine";
import { destination } from "../game/rules";
import type { MemberState, ParticipantState, RoomState } from "../types";
import type { RoomService } from "../rooms/service";

type BotTask =
  | { kind: "role"; userId: string; key: string }
  | { kind: "section"; userId: string; key: string }
  | { kind: "cell"; userId: string; key: string }
  | { kind: "turn"; userId: string; key: string }
  | { kind: "fog"; userId: string; key: string };

type BotAction =
  | { kind: "move"; direction: Direction }
  | { kind: "skill"; skillId: SkillId; target: SkillUseTarget }
  | { kind: "fog" }
  | { kind: "book_throw"; direction: Direction }
  | { kind: "book_read"; targetParticipantId: string };

const ALL_DIRECTIONS: Direction[] = [
  "up",
  "right",
  "down",
  "left",
];

function randomElement<T>(values: T[]): T | null {
  return values.length > 0 ? values[randomInt(0, values.length)]! : null;
}

function randomBoolean(chance = 0.5): boolean {
  return Math.random() < chance;
}

export class BotController {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly roomService: RoomService) {}

  schedule(room: RoomState): void {
    if (room.phase === "closed" || room.phase === "finished") {
      this.clear(room.id);
      return;
    }
    const task = this.pickTask(room);
    if (!task || this.timers.has(room.id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      void this.run(room, room.seq, task.key).catch(() => undefined);
    }, 800);
    this.timers.set(room.id, timer);
  }

  clear(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
  }

  private pickTask(room: RoomState): BotTask | null {
    const game = room.game;
    if (!game) return null;
    if (game.pendingFogVision && !game.pendingFogVision.responded) {
      const sorcerer = game.pendingFogVision.sorcererParticipantId
        ? game.participants[game.pendingFogVision.sorcererParticipantId]
        : null;
      if (sorcerer && this.botMember(room, sorcerer.id)) {
        return {
          kind: "fog",
          userId: sorcerer.userId,
          key: `fog:${game.pendingFogVision.id}:${sorcerer.id}`,
        };
      }
      return null;
    }
    if (room.phase === "role_select") {
      const participant = aliveParticipants(game).find(
        (candidate) => !candidate.roleId && this.botMember(room, candidate.id),
      );
      if (participant) {
        return {
          kind: "role",
          userId: participant.userId,
          key: `role:${participant.id}`,
        };
      }
      return null;
    }
    if (room.phase === "placement") {
      const participant = currentPlacementParticipant(game);
      if (!participant || !this.botMember(room, participant.id)) return null;
      return {
        kind: participant.placedSectionId ? "cell" : "section",
        userId: participant.userId,
        key: `placement:${participant.id}:${participant.placedSectionId ?? "none"}`,
      };
    }
    if (room.phase === "playing") {
      const participant = currentTurnParticipant(game);
      if (participant && this.botMember(room, participant.id)) {
        return {
          kind: "turn",
          userId: participant.userId,
          key: `turn:${game.currentRound}:${participant.id}:${game.seq}`,
        };
      }
    }
    return null;
  }

  private botMember(room: RoomState, participantId: string): MemberState | undefined {
    const participant = room.game?.participants[participantId];
    return participant
      ? room.members.find((member) => member.userId === participant.userId && member.isBot)
      : undefined;
  }

  private async run(room: RoomState, seq: number, key: string): Promise<void> {
    if (room.seq !== seq) {
      this.schedule(room);
      return;
    }
    const task = this.pickTask(room);
    if (!task || task.key !== key) {
      this.schedule(room);
      return;
    }
    const commandId = `bot:${room.id}:${room.seq}:${task.userId}:${task.kind}`;
    await this.roomService.executeCommand(room, task.userId, commandId, () =>
      this.act(room, task),
    );
  }

  private async act(room: RoomState, task: BotTask) {
    const participant = room.game ? findParticipantByUser(room.game, task.userId) : undefined;
    if (!participant) return { events: [], actions: [] };
    if (task.kind === "role") {
      const roleId = this.chooseRole(room, participant);
      return this.roomService.selectRole(room, participant.userId, roleId);
    }
    if (task.kind === "section") {
      const sectionId = this.chooseSection(room, participant);
      return this.roomService.chooseSection(room, participant.userId, sectionId);
    }
    if (task.kind === "cell") {
      const position = this.chooseCell(room, participant);
      return this.roomService.chooseCell(room, participant.userId, position);
    }
    if (task.kind === "fog") {
      const difficulty = this.memberFor(room, participant)?.botDifficulty ?? "pure_bot";
      return this.roomService.respondToFogVision(
        room,
        participant.userId,
        true,
        difficulty === "standard" && participant.invisibilityCloakAvailable
          ? randomBoolean(0.5)
          : randomBoolean(0.35),
      );
    }
    const action = this.chooseTurnAction(room, participant);
    if (action.kind === "move") {
      return this.roomService.move(room, participant.userId, action.direction);
    }
    if (action.kind === "skill") {
      return this.roomService.useSkill(
        room,
        participant.userId,
        action.skillId,
        action.target,
      );
    }
    if (action.kind === "fog") {
      return this.roomService.useFogVision(room, participant.userId);
    }
    if (action.kind === "book_throw") {
      return this.roomService.throwBook(room, participant.userId, action.direction);
    }
    return this.roomService.readBook(
      room,
      participant.userId,
      action.targetParticipantId,
    );
  }

  private memberFor(room: RoomState, participant: ParticipantState): MemberState | undefined {
    return room.members.find((member) => member.userId === participant.userId);
  }

  private chooseRole(room: RoomState, participant: ParticipantState): RoleId {
    const selectedCourses = new Set(
      Object.values(room.game!.participants)
        .map((candidate) => candidate.roleId)
        .filter(Boolean),
    );
    const candidates = Object.values(ROLE_REGISTRY).filter((role) => {
      if (!role.available) return false;
      if (role.requiredMapId && role.requiredMapId !== room.mapId) return false;
      if (role.id === "conductor" && selectedCourses.has("conductor")) return false;
      if (role.id === "sorcerer" && selectedCourses.has("sorcerer")) return false;
      return true;
    });
    return randomElement(candidates)!.id;
  }

  private chooseSection(room: RoomState, participant: ParticipantState): string {
    const used = new Set(
      Object.values(room.game!.participants)
        .filter((candidate) => candidate.id !== participant.id)
        .map((candidate) => candidate.placedSectionId)
        .filter(Boolean),
    );
    const sections = room.game!.map.sections.filter(
      (section) => section.type === "carriage" && !used.has(section.id),
    );
    return randomElement(sections)!.id;
  }

  private chooseCell(room: RoomState, participant: ParticipantState): Position {
    const game = room.game!;
    const section =
      participant.roleId === "conductor"
        ? game.map.sections.find((candidate) => candidate.type === "engine")
        : game.map.sections.find((candidate) => candidate.id === participant.placedSectionId);
    if (!section) throw new Error("NO_AVAILABLE_CELL");
    const occupied = new Set(
      Object.values(game.participants)
        .filter((candidate) => candidate.id !== participant.id && candidate.position)
        .map((candidate) => `${candidate.position!.x}:${candidate.position!.y}`),
    );
    const positions = positionsInSection(section, game.map.columns).filter(
      (position) => !occupied.has(`${position.x}:${position.y}`),
    );
    return randomElement(positions)!;
  }

  private chooseTurnAction(room: RoomState, participant: ParticipantState): BotAction {
    const game = room.game!;
    const difficulty = this.memberFor(room, participant)?.botDifficulty ?? "pure_bot";
    const actions: BotAction[] = [];
    for (const direction of legalMovementDirections(game, participant)) {
      actions.push({ kind: "move", direction });
    }

    const skillId = ROLE_REGISTRY[participant.roleId as RoleId]?.skillIds[0];
    if (skillId && !skillUnavailableReason(game, participant)) {
      const target = this.chooseSkillTarget(game, participant, skillId);
      if (target) actions.push({ kind: "skill", skillId, target });
    }
    if (!fogVisionUnavailableReason(game, participant)) {
      actions.push({ kind: "fog" });
    }
    const bookAction = this.chooseBookAction(game, participant);
    if (bookAction) actions.push(bookAction);

    if (difficulty === "standard") {
      const preferred = actions.find((action) =>
        action.kind === "skill" ||
        action.kind === "fog" ||
        action.kind === "book_read" ||
        action.kind === "book_throw",
      );
      if (preferred) return preferred;
      return this.chooseStandardMove(room, participant, actions);
    }
    return randomElement(actions) ?? { kind: "move", direction: "up" };
  }

  private chooseSkillTarget(
    game: RoomState["game"] & {},
    participant: ParticipantState,
    skillId: SkillId,
  ): SkillUseTarget | null {
    if (skillId === "hunter_shoot") {
      return {
        kind: "direction",
        direction: randomElement(ALL_DIRECTIONS)!,
      };
    }
    if (skillId === "conductor_lock") return { kind: "none" };
    if (skillId === "painter_paint") {
      const position = participant.position;
      if (!position) return null;
      const candidates: Position[] = [];
      for (let y = position.y - 1; y <= position.y + 1; y += 1) {
        for (let x = position.x - 1; x <= position.x + 1; x += 1) {
          if (x >= 0 && x < game.map.columns && y >= 0 && y < game.map.rows) {
            candidates.push({ x, y });
          }
        }
      }
      const target = randomElement(candidates);
      return target ? { kind: "cell", position: target } : null;
    }
    if (skillId === "thief_hook") {
      const section = participant.position
        ? game.map.sections.find(
            (candidate) =>
              participant.position!.y >= candidate.startY &&
              participant.position!.y <= candidate.endY,
          )
        : undefined;
      if (!section) return null;
      const candidates = positionsInSection(section, game.map.columns).filter(
        (position) =>
          position.x !== participant.position!.x ||
          position.y !== participant.position!.y,
      );
      const target = randomElement(candidates);
      return target ? { kind: "cell", position: target } : null;
    }
    return null;
  }

  private chooseBookAction(
    game: RoomState["game"] & {},
    participant: ParticipantState,
  ): BotAction | null {
    if (participant.bookIds.length === 0) return null;
    const hasReadableBook = participant.bookIds.some(
      (bookId) => (game.books[bookId]?.readsRemaining ?? 0) > 0,
    );
    if (participant.roleId === "archaeologist" && hasReadableBook) {
      const targets = Object.values(game.participants).filter(
        (candidate) => candidate.alive && candidate.id !== participant.id,
      );
      const target = randomElement(targets);
      if (target && randomBoolean(0.65)) {
        return { kind: "book_read", targetParticipantId: target.id };
      }
    }
    return {
      kind: "book_throw",
      direction: randomElement(ALL_DIRECTIONS)!,
    };
  }

  private chooseStandardMove(
    room: RoomState,
    participant: ParticipantState,
    actions: BotAction[],
  ): BotAction {
    const moves = actions.filter(
      (action): action is Extract<BotAction, { kind: "move" }> =>
        action.kind === "move",
    );
    if (moves.length === 0) return { kind: "move", direction: "up" };
    const currentSection = participant.position
      ? getSectionAt(room.game!.map, participant.position)
      : undefined;
    const scored = moves.map((action) => {
      const target = destination(participant.position!, action.direction);
      const targetSection = getSectionAt(room.game!.map, target);
      let score = randomInt(0, 3);
      if (currentSection && targetSection && currentSection.id !== targetSection.id) {
        score += 4;
      }
      if (targetSection?.type === "storage") score += 1;
      return { action, score };
    });
    scored.sort((left, right) => right.score - left.score);
    return scored[0]!.action;
  }
}
