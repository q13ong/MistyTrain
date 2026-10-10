/**
 * 持久化仓储函数。
 *
 * 对局过程中写入的是“事件 + 行动 + 完整快照”：
 * - 行动日志用于赛后统计和逐步回放；
 * - 事件日志用于重建状态、旧回放兼容和审计；
 * - 快照用于服务重启后的快速恢复。
 */
import {
  and,
  avg,
  count,
  desc,
  eq,
  gt,
  isNull,
  sql,
  sum,
} from "drizzle-orm";
import {
  ROLE_REGISTRY,
  type ActionLog,
  type LeaderboardEntry,
  type PlayerResult,
  type ReplayEvent,
} from "@fog-train/shared";
import { db } from "./client";
import {
  gameActions,
  gameEvents,
  gameParticipants,
  playerGameResults,
  gameSnapshots,
  roomMessages,
  rooms,
  sessions,
  users,
} from "./schema";

export interface UserRecord {
  id: string;
  email: string;
  nickname: string;
  nicknameKey: string;
  passwordHash: string;
  createdAt: Date;
}

export async function createUser(record: UserRecord): Promise<void> {
  await db.insert(users).values(record);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function findUserByNicknameKey(nicknameKey: string): Promise<UserRecord | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.nicknameKey, nicknameKey))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createSession(record: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}): Promise<void> {
  await db.insert(sessions).values({ ...record, revokedAt: null });
}

export async function findSessionByTokenHash(tokenHash: string) {
  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, tokenHash));
}

export async function saveRoomSnapshot(record: {
  roomId: string;
  gameId: string | null;
  seq: number;
  state: unknown;
  code: string;
  mapId: string;
  hostUserId: string;
  status: string;
  initialPlayerCount: number;
  settings: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}): Promise<void> {
  const existing = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.id, record.roomId))
    .limit(1);

  const values = {
    id: record.roomId,
    code: record.code,
    mapId: record.mapId,
    hostUserId: record.hostUserId,
    status: record.status,
    initialPlayerCount: record.initialPlayerCount,
    settings: record.settings,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    closedAt: record.closedAt,
  };

  if (existing[0]) {
    await db.update(rooms).set(values).where(eq(rooms.id, record.roomId));
  } else {
    await db.insert(rooms).values(values);
  }

  const snapshot = await db
    .select({ id: gameSnapshots.id })
    .from(gameSnapshots)
    .where(eq(gameSnapshots.roomId, record.roomId))
    .limit(1);
  const snapshotValues = {
    roomId: record.roomId,
    gameId: record.gameId,
    seq: record.seq,
    state: record.state,
    createdAt: new Date(),
  };
  if (snapshot[0]) {
    await db
      .update(gameSnapshots)
      .set(snapshotValues)
      .where(eq(gameSnapshots.id, snapshot[0].id));
  } else {
    await db.insert(gameSnapshots).values(snapshotValues);
  }
}

export async function findLatestSnapshotByRoomId(roomId: string) {
  const rows = await db
    .select({ state: gameSnapshots.state, seq: gameSnapshots.seq })
    .from(gameSnapshots)
    .where(eq(gameSnapshots.roomId, roomId))
    .orderBy(desc(gameSnapshots.seq), desc(gameSnapshots.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadLatestRoomSnapshots(): Promise<
  Array<{ roomId: string; state: any }>
> {
  const rows = await db
    .select({
      roomId: gameSnapshots.roomId,
      state: gameSnapshots.state,
      seq: gameSnapshots.seq,
    })
    .from(gameSnapshots)
    .orderBy(desc(gameSnapshots.seq), desc(gameSnapshots.id));

  const seen = new Set<string>();
  const snapshots: Array<{ roomId: string; state: any }> = [];
  for (const row of rows) {
    if (seen.has(row.roomId)) continue;
    seen.add(row.roomId);
    snapshots.push({ roomId: row.roomId, state: row.state as any });
  }
  return snapshots;
}

export async function findRoomByCode(code: string) {
  const rows = await db
    .select({
      id: rooms.id,
      code: rooms.code,
      mapId: rooms.mapId,
      status: rooms.status,
      hostUserId: rooms.hostUserId,
      settings: rooms.settings,
    })
    .from(rooms)
    .where(eq(rooms.code, code))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveGameParticipant(participant: PlayerResult & {
  gameId: string;
  roomId: string;
}) {
  const values = {
    id: participant.participantId,
    gameId: participant.gameId,
    roomId: participant.roomId,
    userId: participant.userId,
    nickname: participant.nickname,
    isBot: participant.isBot,
    color: participant.color,
    roleId: participant.roleId,
    finalRank: participant.finalRank,
    survivedRounds: participant.survivedRounds,
    moveCount: participant.moveCount,
    skillUseCount: participant.skillUseCount,
    killCount: participant.killCount,
    waterCount: participant.waterCount,
    deathRound: participant.deathRound,
    deathReason: participant.deathReason,
    initialPosition: participant.initialPosition,
    finalPosition: participant.finalPosition,
    updatedAt: new Date(),
  };
  const existing = await db
    .select({ id: gameParticipants.id })
    .from(gameParticipants)
    .where(eq(gameParticipants.id, participant.participantId))
    .limit(1);
  if (existing[0]) {
    await db.update(gameParticipants).set(values).where(eq(gameParticipants.id, participant.participantId));
  } else {
    await db.insert(gameParticipants).values(values);
  }
}

export async function savePlayerGameResults(
  results: Array<{
    gameId: string;
    userId: string;
    roleId: string;
    finalRank: number;
    playerCount: number;
    rating: number;
    killCount: number;
    deathCount: number;
    won: boolean;
    finishedAt: Date;
  }>,
): Promise<void> {
  for (const result of results) {
    const existing = await db
      .select({ gameId: playerGameResults.gameId })
      .from(playerGameResults)
      .where(
        and(
          eq(playerGameResults.gameId, result.gameId),
          eq(playerGameResults.userId, result.userId),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    await db.insert(playerGameResults).values(result);
  }
}

export async function getGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  const totals = await db
    .select({
      userId: users.id,
      nickname: users.nickname,
      rating: avg(playerGameResults.rating),
      gamesPlayed: count(playerGameResults.gameId),
      killCount: sum(playerGameResults.killCount),
      deathCount: sum(playerGameResults.deathCount),
    })
    .from(users)
    .leftJoin(playerGameResults, eq(users.id, playerGameResults.userId))
    .groupBy(users.id, users.nickname);

  const roleRows = await db
    .select({
      userId: playerGameResults.userId,
      roleId: playerGameResults.roleId,
      gamesPlayed: count(playerGameResults.gameId),
      wins: sql<number>`sum(case when ${playerGameResults.won} then 1 else 0 end)`,
    })
    .from(playerGameResults)
    .groupBy(playerGameResults.userId, playerGameResults.roleId);

  const rolesByUser = new Map<string, typeof roleRows>();
  for (const row of roleRows) {
    const rows = rolesByUser.get(row.userId) ?? [];
    rows.push(row);
    rolesByUser.set(row.userId, rows);
  }

  return totals
    .map((row: any) => {
      const gamesPlayed = Number(row.gamesPlayed ?? 0);
      const roleRowsForUser = rolesByUser.get(row.userId) ?? [];
      const bestRole = [...roleRowsForUser].sort((left, right) => {
        const leftGames = Number(left.gamesPlayed ?? 0);
        const rightGames = Number(right.gamesPlayed ?? 0);
        const leftWins = Number(left.wins ?? 0);
        const rightWins = Number(right.wins ?? 0);
        const leftRate = leftGames > 0 ? leftWins / leftGames : 0;
        const rightRate = rightGames > 0 ? rightWins / rightGames : 0;
        return (
          rightRate - leftRate ||
          rightGames - leftGames ||
          left.roleId.localeCompare(right.roleId)
        );
      })[0];
      const kills = Number(row.killCount ?? 0);
      const deaths = Number(row.deathCount ?? 0);
      const bestRoleGames = Number(bestRole?.gamesPlayed ?? 0);
      const bestRoleWins = Number(bestRole?.wins ?? 0);
      return {
        userId: row.userId,
        nickname: row.nickname,
        rating: Number(Number(row.rating ?? 0).toFixed(2)),
        gamesPlayed,
        bestRoleId: bestRole?.roleId ?? null,
        bestRoleName: bestRole
          ? ROLE_REGISTRY[bestRole.roleId as keyof typeof ROLE_REGISTRY]?.name ??
            bestRole.roleId
          : "暂无",
        bestRoleWinRate:
          bestRoleGames > 0 ? Number(((bestRoleWins / bestRoleGames) * 100).toFixed(1)) : 0,
        bestRoleWins,
        bestRoleGames,
        averageKd: Number((deaths > 0 ? kills / deaths : kills).toFixed(2)),
      } satisfies LeaderboardEntry;
    })
    .sort(
      (left: LeaderboardEntry, right: LeaderboardEntry) =>
        right.rating - left.rating ||
        right.gamesPlayed - left.gamesPlayed ||
        left.nickname.localeCompare(right.nickname, "zh-CN"),
    );
}

export async function saveGameAction(action: ActionLog & {
  gameId: string;
  roomId: string;
}) {
  await db.insert(gameActions).values({
    id: action.id,
    gameId: action.gameId,
    roomId: action.roomId,
    seq: action.seq,
    round: action.round,
    participantId: action.participantId,
    actionType: action.actionType,
    fromPosition: action.fromPosition,
    toPosition: action.toPosition,
    direction: action.direction,
    crossedDoor: action.crossedDoor,
    drank: action.drank,
    skillId: action.skillId,
    skillTarget: action.skillTarget,
    killedParticipantIds: action.killedParticipantIds,
    died: action.died,
    createdAt: new Date(action.createdAt),
  });
}

export async function saveGameEvent(event: ReplayEvent & {
  gameId: string;
  roomId: string;
}) {
  await db.insert(gameEvents).values({
    id: event.id,
    gameId: event.gameId,
    roomId: event.roomId,
    seq: event.seq,
    round: event.round,
    type: event.type,
    actorParticipantId: event.actorParticipantId,
    payload: event.payload,
    createdAt: new Date(event.createdAt),
  });
}

export async function saveRoomMessage(message: {
  id: string;
  roomId: string;
  userId: string;
  phraseId: string;
  text: string;
  createdAt: Date;
}) {
  await db.insert(roomMessages).values(message);
}

export async function getReplay(roomId: string) {
  const [participantRows, actionRows, eventRows] = await Promise.all([
    db.select().from(gameParticipants).where(eq(gameParticipants.roomId, roomId)),
    db.select().from(gameActions).where(eq(gameActions.roomId, roomId)).orderBy(gameActions.seq),
    db.select().from(gameEvents).where(eq(gameEvents.roomId, roomId)).orderBy(gameEvents.seq),
  ]);

  return { participantRows, actionRows, eventRows };
}

export async function deleteRoomData(roomId: string): Promise<void> {
  await db.delete(gameActions).where(eq(gameActions.roomId, roomId));
  await db.delete(gameEvents).where(eq(gameEvents.roomId, roomId));
  await db.delete(gameParticipants).where(eq(gameParticipants.roomId, roomId));
  await db.delete(gameSnapshots).where(eq(gameSnapshots.roomId, roomId));
  await db.delete(roomMessages).where(eq(roomMessages.roomId, roomId));
  await db.delete(rooms).where(eq(rooms.id, roomId));
}

export async function deleteGameHistory(roomId: string): Promise<void> {
  // 同房重开时只清除上一局的历史，不删除房间本身；新局会重新写入日志和快照。
  await db.delete(gameActions).where(eq(gameActions.roomId, roomId));
  await db.delete(gameEvents).where(eq(gameEvents.roomId, roomId));
  await db.delete(gameParticipants).where(eq(gameParticipants.roomId, roomId));
  await db.delete(gameSnapshots).where(eq(gameSnapshots.roomId, roomId));
  await db.delete(roomMessages).where(eq(roomMessages.roomId, roomId));
}
