/**
 * HTTP API。
 *
 * REST 负责账号、房间创建/加入、赛后回放和静态前端；
 * 实时命令与对局同步走 Socket.IO，避免 HTTP 轮询破坏回合顺序。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import {
  DEFAULT_MAP_ID,
  MAP_REGISTRY,
  type MapId,
  type ReplayPayload,
} from "@fog-train/shared";
import { config, isAllowedOrigin, isProduction } from "../config";
import {
  clearSessionCookie,
  createUserSession,
  getUserBySessionToken,
  loginUser,
  logoutSession,
  registerUser,
  SESSION_COOKIE,
  setSessionCookie,
} from "../auth/service";
import { RoomService } from "../rooms/service";
import {
  findLatestSnapshotByRoomId,
  getGlobalLeaderboard,
  getReplay,
} from "../db/repository";
import type { RoomState } from "../types";
import { getLeaderboard } from "../game/engine";

const registerSchema = z.object({
  email: z.email().max(320),
  nickname: z.string().trim().min(2).max(16),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(72),
});

const createRoomSchema = z.object({
  mapId: z.enum(["standard_train", "luxury_train", "fog_village"]).optional(),
});

async function currentUser(request: FastifyRequest) {
  return getUserBySessionToken(request.cookies[SESSION_COOKIE]);
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) {
    await reply.code(401).send({ error: "UNAUTHORIZED", message: "请先登录" });
    return null;
  }
  return user;
}

function authError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const messages: Record<string, string> = {
    EMAIL_EXISTS: "该邮箱已注册",
    NICKNAME_EXISTS: "该昵称已被使用",
    INVALID_CREDENTIALS: "邮箱或密码错误",
  };
  return { code, message: messages[code] ?? "操作失败" };
}

export function buildApp(roomService: RoomService): FastifyInstance {
  const app = Fastify({
    logger: {
      level: isProduction ? "info" : "debug",
    },
    trustProxy: true,
  });

  app.register(cookie);
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, {
    max: 180,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin)) {
      await reply.code(403).send({ error: "INVALID_ORIGIN" });
    }
  });

  app.get("/healthz", async () => ({ ok: true, now: new Date().toISOString() }));

  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", message: "注册信息格式不正确" });
    }
    try {
      const user = await registerUser(parsed.data);
      const token = await createUserSession(user.id);
      setSessionCookie(reply, token);
      return { user: { id: user.id, email: user.email, nickname: user.nickname } };
    } catch (error) {
      return reply.code(409).send(authError(error));
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", message: "登录信息格式不正确" });
    }
    try {
      const user = await loginUser(parsed.data.email, parsed.data.password);
      const token = await createUserSession(user.id);
      setSessionCookie(reply, token);
      return { user: { id: user.id, email: user.email, nickname: user.nickname } };
    } catch (error) {
      return reply.code(401).send(authError(error));
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await logoutSession(request.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => ({
    user: await currentUser(request),
  }));

  app.get("/api/leaderboard", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    return { entries: await getGlobalLeaderboard() };
  });

  app.post("/api/rooms", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = createRoomSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", message: "地图选择无效" });
    }
    const mapId: MapId = parsed.data.mapId ?? DEFAULT_MAP_ID;
    if (!MAP_REGISTRY[mapId]?.available) {
      return reply.code(400).send({ error: "MAP_UNAVAILABLE", message: "该地图尚未开放" });
    }
    const room = await roomService.createRoom(
      { id: user.id, nickname: user.nickname },
      mapId,
    );
    return {
      roomId: room.id,
      roomCode: room.code,
      shareUrl: `${config.PUBLIC_ORIGIN}/join/${room.code}`,
    };
  });

  app.get<{ Params: { code: string } }>("/api/rooms/:code", async (request, reply) => {
    const room = await roomService.getRoomByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
    const playerCount = room.members.filter(
      (member) => member.kind === "player" && member.control !== "left",
    ).length;
    const spectatorCount = room.members.filter(
      (member) => member.kind === "spectator" && member.control !== "left",
    ).length;
    return {
      roomId: room.id,
      roomCode: room.code,
      status: room.phase,
      playerCount,
      spectatorCount,
      canJoinAsPlayer: room.phase === "lobby" && playerCount < 8,
      canJoinAsSpectator:
        room.phase !== "closed" && spectatorCount < room.settings.maxSpectators,
    };
  });

  app.post<{ Params: { code: string } }>("/api/rooms/:code/join", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const room = await roomService.getRoomByCode(request.params.code);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      const joined = await roomService.joinRoom(room, { id: user.id, nickname: user.nickname });
      return {
        roomId: joined.room.id,
        roomCode: joined.room.code,
        kind: joined.kind,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      return reply.code(code === "ROOM_FULL" ? 409 : 404).send({ error: code });
    }
  });

  app.get<{ Params: { code: string } }>("/api/rooms/:code/replay", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const room = await roomService.getRoomByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
    if (room.phase !== "finished") {
      return reply.code(409).send({ error: "GAME_NOT_FINISHED" });
    }
    const snapshot = room.game
      ? { state: room }
      : await findLatestSnapshotByRoomId(room.id);
    const persisted = await getReplay(room.id);
    const state = snapshot?.state as RoomState | undefined;
    if (!state?.game) return reply.code(404).send({ error: "REPLAY_NOT_READY" });

    const replay: ReplayPayload = {
      roomCode: room.code,
      mapId: state.game.mapId,
      mapName: MAP_REGISTRY[state.game.mapId]?.name ?? "暂无",
      map: state.game.map,
      leaderboard: getLeaderboard(state.game),
      actions: persisted.actionRows.map((row: any) => ({
        id: row.id,
        seq: row.seq,
        round: row.round,
        participantId: row.participantId,
        actionType: row.actionType,
        fromPosition: row.fromPosition,
        toPosition: row.toPosition,
        direction: row.direction,
        crossedDoor: row.crossedDoor,
        drank: row.drank,
        skillId: row.skillId,
        skillTarget: row.skillTarget,
        killedParticipantIds: row.killedParticipantIds,
        died: row.died,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      events: persisted.eventRows.map((row: any) => ({
        id: row.id,
        seq: row.seq,
        round: row.round,
        type: row.type,
        actorParticipantId: row.actorParticipantId,
        payload: row.payload,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
    };
    return replay;
  });

  const webDist = fileURLToPath(new URL("../../../../apps/web/dist", import.meta.url));
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.get("/*", async (request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
