import {
  bigserial,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    nickname: varchar("nickname", { length: 32 }).notNull(),
    nicknameKey: varchar("nickname_key", { length: 32 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_nickname_key_unique").on(table.nicknameKey),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey(),
    code: varchar("code", { length: 6 }).notNull(),
    mapId: varchar("map_id", { length: 64 }).notNull().default("standard_train"),
    hostUserId: uuid("host_user_id").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    initialPlayerCount: integer("initial_player_count").notNull().default(0),
    settings: jsonb("settings").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("rooms_code_unique").on(table.code)],
);

export const gameParticipants = pgTable("game_participants", {
  id: uuid("id").primaryKey(),
  gameId: uuid("game_id").notNull(),
  roomId: uuid("room_id").notNull(),
  userId: uuid("user_id").notNull(),
  nickname: varchar("nickname", { length: 32 }).notNull(),
  isBot: boolean("is_bot").notNull().default(false),
  color: varchar("color", { length: 16 }).notNull(),
  roleId: varchar("role_id", { length: 64 }).notNull(),
  finalRank: integer("final_rank"),
  survivedRounds: integer("survived_rounds").notNull().default(0),
  moveCount: integer("move_count").notNull().default(0),
  skillUseCount: integer("skill_use_count").notNull().default(0),
  killCount: integer("kill_count").notNull().default(0),
  waterCount: integer("water_count").notNull().default(0),
  deathRound: integer("death_round"),
  deathReason: varchar("death_reason", { length: 32 }),
  initialPosition: jsonb("initial_position"),
  finalPosition: jsonb("final_position"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const playerGameResults = pgTable(
  "player_game_results",
  {
    gameId: uuid("game_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: varchar("role_id", { length: 64 }).notNull(),
    finalRank: integer("final_rank").notNull(),
    playerCount: integer("player_count").notNull(),
    rating: doublePrecision("rating").notNull(),
    killCount: integer("kill_count").notNull().default(0),
    deathCount: integer("death_count").notNull().default(0),
    won: boolean("won").notNull().default(false),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.userId] }),
    uniqueIndex("player_game_results_game_user_unique").on(
      table.gameId,
      table.userId,
    ),
  ],
);

export const gameActions = pgTable("game_actions", {
  id: uuid("id").primaryKey(),
  gameId: uuid("game_id").notNull(),
  roomId: uuid("room_id").notNull(),
  seq: integer("seq").notNull(),
  round: integer("round"),
  participantId: uuid("participant_id").notNull(),
  actionType: varchar("action_type", { length: 32 }).notNull(),
  fromPosition: jsonb("from_position"),
  toPosition: jsonb("to_position"),
  direction: varchar("direction", { length: 32 }),
  crossedDoor: boolean("crossed_door").notNull().default(false),
  drank: boolean("drank").notNull().default(false),
  skillId: varchar("skill_id", { length: 64 }),
  skillTarget: jsonb("skill_target"),
  killedParticipantIds: jsonb("killed_participant_ids").notNull(),
  died: boolean("died").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const gameEvents = pgTable("game_events", {
  id: uuid("id").primaryKey(),
  gameId: uuid("game_id").notNull(),
  roomId: uuid("room_id").notNull(),
  seq: integer("seq").notNull(),
  round: integer("round"),
  type: varchar("type", { length: 64 }).notNull(),
  actorParticipantId: uuid("actor_participant_id"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const gameSnapshots = pgTable("game_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  roomId: uuid("room_id").notNull(),
  gameId: uuid("game_id"),
  seq: integer("seq").notNull(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("game_snapshots_room_unique").on(table.roomId),
]);

export const roomMessages = pgTable("room_messages", {
  id: uuid("id").primaryKey(),
  roomId: uuid("room_id").notNull(),
  userId: uuid("user_id").notNull(),
  phraseId: varchar("phrase_id", { length: 32 }).notNull(),
  text: varchar("text", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
