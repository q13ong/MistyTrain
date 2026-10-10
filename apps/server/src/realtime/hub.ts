/**
 * Socket.IO 实时层。
 *
 * 所有对外事件都在这里按可见范围分发。特别注意：
 * - 存活玩家收不到其他玩家的 from/to/direction；
 * - 死亡玩家和观战者属于 spectator view；
 * - 雾视只公开“某人使用了雾视”，不公开揭示结果。
 */
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import type {
  CommandAck,
  CommandEnvelope,
  RoomSnapshot,
} from "@fog-train/shared";
import { config, isAllowedOrigin, isProduction } from "../config";
import { getUserBySessionToken, parseCookieHeader, SESSION_COOKIE } from "../auth/service";
import type { RoomChange } from "../rooms/service";
import { RoomService, type RoomUser } from "../rooms/service";
import type { RoomState } from "../types";

interface SocketData {
  user: RoomUser;
  roomId?: string;
  replaced?: boolean;
}

type AppSocket = Socket<any, any, any, SocketData>;

function ackError(error: unknown): CommandAck {
  return {
    ok: false,
    code: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "操作失败",
  };
}

export function attachRealtime(
  httpServer: HttpServer,
  roomService: RoomService,
  origin: string,
): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: isProduction
        ? origin
        : (requestOrigin, callback) =>
            callback(null, isAllowedOrigin(requestOrigin)),
      credentials: true,
    },
    maxHttpBufferSize: 64 * 1024,
  });
  const activeSockets = new Map<string, string>();

  io.use(async (socket, next) => {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie);
    const user = await getUserBySessionToken(cookies[SESSION_COOKIE]);
    if (!user) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    socket.data.user = user;
    next();
  });

  const emitSnapshots = async (room: RoomState) => {
    const sockets = await io.in(room.id).fetchSockets();
    for (const socket of sockets as unknown as AppSocket[]) {
      if (!socket.data.user) continue;
      try {
        const snapshot = roomService.buildSnapshot(room, socket.data.user.id);
        socket.emit("room:snapshot", snapshot);
        if (snapshot.self) socket.emit("game:self_state", snapshot.self);
        if (snapshot.spectatorMap && snapshot.map && snapshot.players) {
          socket.emit("game:spectator_state", {
            map: snapshot.map,
            players: snapshot.players,
          });
        }
      } catch {
        // A member may have just left the room.
      }
    }
  };

  const isSpectatorSocket = (room: RoomState, socket: AppSocket): boolean => {
    const member = room.members.find((candidate) => candidate.userId === socket.data.user.id);
    if (!member) return false;
    if (member.kind === "spectator" || room.phase === "finished") return true;
    const participant = room.game
      ? Object.values(room.game.participants).find(
          (candidate) => candidate.userId === socket.data.user.id,
        )
      : null;
    return Boolean(participant && !participant.alive);
  };

  const emitChange = async (room: RoomState, change: RoomChange) => {
    await emitSnapshots(room);
    for (const event of change.events) {
      switch (event.type) {
        case "phase_changed":
          io.to(room.id).emit("phase:changed", { phase: room.phase });
          break;
        case "activity":
          io.to(room.id).emit("public:activity", {
            actor: {
              participantId: String(event.payload.actorParticipantId ?? ""),
              nickname: String(event.payload.nickname ?? ""),
            },
            phase: room.phase,
            deadlineAt:
              typeof event.payload.deadlineAt === "string" ? event.payload.deadlineAt : null,
          });
          break;
        case "round_started":
          io.to(room.id).emit("public:round_started", {
            round: Number(event.payload.round),
          });
          break;
        case "round_ended":
          io.to(room.id).emit("public:round_ended", {
            round: Number(event.payload.round),
          });
          break;
        case "death":
          io.to(room.id).emit("public:death", {
            participantId: String(event.payload.participantId),
            nickname: String(event.payload.nickname),
            reason: String(event.payload.publicReason) as any,
          });
          break;
        case "role_selected":
          io.to(room.id).emit("public:role_selected", {
            participantId: String(event.payload.participantId),
            nickname: String(event.payload.nickname),
            roleId: String(event.payload.roleId),
            roleName: String(event.payload.roleName),
          });
          break;
        case "skill_used":
          io.to(room.id).emit("public:skill_used", {
            participantId: String(event.payload.participantId),
            nickname: String(event.payload.nickname),
            skillId: String(event.payload.skillId),
            skillName: String(event.payload.skillName),
          });
          break;
        case "door_locked":
          io.to(room.id).emit("public:door_locked", {
            connectionId: String(event.payload.connectionId),
            remainingConductorTurns: Number(event.payload.remainingConductorTurns),
          });
          break;
        case "paint_applied":
          io.to(room.id).emit("public:paint_applied", {
            position: event.payload.position as { x: number; y: number },
          });
          break;
        case "gunshot":
          io.to(room.id).emit("public:gunshot", {
            position: event.payload.position as { x: number; y: number },
          });
          break;
        case "hook_used":
          io.to(room.id).emit("public:hook_used", {
            signal: event.payload.signal as {
              id: string;
              participantId: string;
              color: string;
              from: { x: number; y: number };
              to: { x: number; y: number };
              round: number;
              createdAt: string;
            },
          });
          break;
        case "fog_vision_used":
          io.to(room.id).emit("public:fog_vision_used", {
            participantId: String(event.payload.participantId),
            nickname: String(event.payload.nickname),
          });
          io.to(room.id).emit("public:fog_vision_alert", {
            participantId: String(event.payload.participantId),
            nickname: String(event.payload.nickname),
            status: "pending" as const,
            deadlineAt: room.game?.pendingFogVision?.deadlineAt ?? null,
          });
          break;
        case "fog_resolved":
          io.to(room.id).emit("public:fog_vision_alert", {
            participantId: String(event.payload.casterParticipantId),
            status: "resolved" as const,
            deadlineAt: null,
          });
          break;
        case "fog_vision_ended":
          io.to(room.id).emit("public:fog_vision_alert", {
            participantId: String(event.payload.participantId),
            status: "ended" as const,
            deadlineAt: null,
          });
          break;
        case "chat":
          io.to(room.id).emit("room:chat", event.payload);
          break;
        case "actor_moved":
          // 移动细节只给行动者本人和观战者；其他存活玩家最多看到“正在操作中”。
          for (const socket of (await io.in(room.id).fetchSockets()) as unknown as AppSocket[]) {
            const isActor = socket.data.user.id === event.payload.userId;
            const participant = room.game
              ? Object.values(room.game.participants).find(
                  (candidate) => candidate.userId === socket.data.user.id,
                )
              : null;
            if (isActor || isSpectatorSocket(room, socket)) {
              socket.emit("game:actor_moved", {
                participantId: String(event.payload.participantId),
                from: event.payload.from,
                to: event.payload.to,
                direction: event.payload.direction,
                drank: Boolean(event.payload.drank),
              });
            } else if (participant) {
              // Living players never receive another player's from/to/direction.
            }
          }
          break;
        case "game_finished":
          io.to(room.id).emit("public:game_finished", {
            leaderboard: event.payload.leaderboard,
          });
          break;
        case "replay_ready":
          io.to(room.id).emit("game:replay_ready", { roomCode: room.code });
          break;
        default:
          break;
      }
    }
  };

  roomService.setChangeHandler(emitChange);

  io.on("connection", (socket: AppSocket) => {
    socket.on(
      "room:sync",
      async (payload: { roomId: string }, ack: (response: CommandAck) => void) => {
        const room = roomService.getRoomById(payload.roomId);
        if (!room) {
          ack(ackError(new Error("ROOM_NOT_FOUND")));
          return;
        }
        if (socket.data.roomId && socket.data.roomId !== room.id) {
          activeSockets.delete(`${socket.data.roomId}:${socket.data.user.id}`);
          await socket.leave(socket.data.roomId);
        }
        const socketKey = `${room.id}:${socket.data.user.id}`;
        const previousId = activeSockets.get(socketKey);
        if (previousId && previousId !== socket.id) {
          const previous = io.sockets.sockets.get(previousId) as AppSocket | undefined;
          if (previous) {
            previous.data.replaced = true;
            previous.emit("session:replaced");
            previous.disconnect(true);
          }
        }
        activeSockets.set(socketKey, socket.id);
        socket.data.roomId = room.id;
        await socket.join(room.id);

        const commandId = `connect:${socket.id}`;
        const ackResult = await roomService.executeCommand(room, socket.data.user.id, commandId, () =>
          roomService.markConnected(room, socket.data.user.id),
        );
        if (!ackResult.ok) {
          ack(ackResult);
          return;
        }
        try {
          socket.emit("room:snapshot", roomService.buildSnapshot(room, socket.data.user.id));
        } catch (error) {
          ack(ackError(error));
          return;
        }
        ack({ ok: true, roomSeq: room.seq });
      },
    );

    const commandHandler =
      (
        eventName: string,
        handler: (
          room: RoomState,
          userId: string,
          envelope: CommandEnvelope<any>,
        ) => Promise<any> | any,
      ) =>
      async (envelope: CommandEnvelope<any>, ack: (response: CommandAck) => void) => {
        try {
          const room = await resolveRoom(envelope.roomId);
          const response = await roomService.executeCommand(
            room,
            socket.data.user.id,
            envelope.commandId,
            () => handler(room, socket.data.user.id, envelope),
          );
          if (eventName === "room:leave" && response.ok) {
            activeSockets.delete(`${room.id}:${socket.data.user.id}`);
            await socket.leave(room.id);
          }
          ack(response);
        } catch (error) {
          ack(ackError(error));
        }
      };

    const resolveRoom = async (roomId: string): Promise<RoomState> => {
      const room = roomService.getRoomById(roomId);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      return room;
    };

    socket.on(
      "room:leave",
      commandHandler("room:leave", (room, userId) => roomService.leaveRoom(room, userId)),
    );
    socket.on(
      "room:ready",
      commandHandler("room:ready", (room, userId, envelope) =>
        roomService.ready(room, userId, Boolean(envelope.payload.ready)),
      ),
    );
    socket.on(
      "room:start",
      commandHandler("room:start", (room, userId) => roomService.startRoom(room, userId)),
    );
    socket.on(
      "room:chat",
      commandHandler("room:chat", (room, userId, envelope) =>
        roomService.chat(room, userId, String(envelope.payload.text ?? "")),
      ),
    );
    socket.on(
      "room:rematch",
      commandHandler("room:rematch", (room, userId) => roomService.rematch(room, userId)),
    );
    socket.on(
      "room:end_bot_game",
      commandHandler("room:end_bot_game", (room, userId) =>
        roomService.endBotGame(room, userId),
      ),
    );
    socket.on(
      "room:add_bot",
      commandHandler("room:add_bot", (room, userId, envelope) =>
        roomService.addBot(
          room,
          userId,
          envelope.payload.difficulty === "standard" ? "standard" : "pure_bot",
        ),
      ),
    );
    socket.on(
      "room:remove_bot",
      commandHandler("room:remove_bot", (room, userId, envelope) =>
        roomService.removeBot(room, userId, String(envelope.payload.botUserId)),
      ),
    );
    socket.on(
      "role:select",
      commandHandler("role:select", (room, userId, envelope) =>
        roomService.selectRole(room, userId, String(envelope.payload.roleId)),
      ),
    );
    socket.on(
      "placement:choose_section",
      commandHandler("placement:choose_section", (room, userId, envelope) =>
        roomService.chooseSection(room, userId, String(envelope.payload.sectionId)),
      ),
    );
    socket.on(
      "placement:choose_cell",
      commandHandler("placement:choose_cell", (room, userId, envelope) =>
        roomService.chooseCell(room, userId, envelope.payload.position),
      ),
    );
    socket.on(
      "game:move",
      commandHandler("game:move", (room, userId, envelope) =>
        roomService.move(room, userId, envelope.payload.direction),
      ),
    );
    socket.on(
      "game:skill_use",
      commandHandler("game:skill_use", (room, userId, envelope) =>
        roomService.useSkill(
          room,
          userId,
          envelope.payload.skillId,
          envelope.payload.target,
        ),
      ),
    );
    socket.on(
      "game:fog_vision",
      commandHandler("game:fog_vision", (room, userId) =>
        roomService.useFogVision(room, userId),
      ),
    );
    socket.on(
      "game:fog_response",
      commandHandler("game:fog_response", (room, userId, envelope) =>
        roomService.respondToFogVision(
          room,
          userId,
          Boolean(envelope.payload.useProphecyBall),
          Boolean(envelope.payload.useInvisibility),
        ),
      ),
    );
    socket.on(
      "game:book_throw",
      commandHandler("game:book_throw", (room, userId, envelope) =>
        roomService.throwBook(room, userId, envelope.payload.direction),
      ),
    );
    socket.on(
      "game:book_read",
      commandHandler("game:book_read", (room, userId, envelope) =>
        roomService.readBook(room, userId, String(envelope.payload.targetParticipantId)),
      ),
    );
    socket.on("game:skill_target", (_payload: unknown, ack: (response: CommandAck) => void) => {
      ack({ ok: false, code: "SKILL_NOT_IMPLEMENTED", message: "当前角色没有技能" });
    });
    socket.on("game:skill_confirm", (_payload: unknown, ack: (response: CommandAck) => void) => {
      ack({ ok: false, code: "SKILL_NOT_IMPLEMENTED", message: "当前角色没有技能" });
    });

    socket.on("disconnect", async () => {
      if (socket.data.replaced || !socket.data.roomId) return;
      const room = roomService.getRoomById(socket.data.roomId);
      if (!room) return;
      const socketKey = `${room.id}:${socket.data.user.id}`;
      if (activeSockets.get(socketKey) !== socket.id) return;
      activeSockets.delete(socketKey);
      await roomService.executeCommand(
        room,
        socket.data.user.id,
        `disconnect:${socket.id}`,
        () => roomService.markDisconnected(room, socket.data.user.id),
      );
    });
  });

  return io;
}
