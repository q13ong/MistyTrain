/**
 * 数据库入口。
 *
 * 生产环境使用 PostgreSQL；本地开发和测试在没有 DATABASE_URL 时使用 PGlite，
 * 两者都走 PostgreSQL 方言和同一套迁移 SQL，避免本地/线上出现两套表结构。
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { config, isProduction } from "../config";

export let db: any;
export let closeDatabase: () => Promise<void> = async () => undefined;

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email varchar(320) NOT NULL,
    nickname varchar(32) NOT NULL,
    nickname_key varchar(32) NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_key_unique ON users (nickname_key)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions (token_hash)`,
  `CREATE TABLE IF NOT EXISTS rooms (
    id uuid PRIMARY KEY,
    code varchar(6) NOT NULL,
    map_id varchar(64) NOT NULL DEFAULT 'standard_train',
    host_user_id uuid NOT NULL,
    status varchar(32) NOT NULL,
    initial_player_count integer NOT NULL DEFAULT 0,
    settings jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    closed_at timestamptz
  )`,
  `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS map_id varchar(64) NOT NULL DEFAULT 'standard_train'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS rooms_code_unique ON rooms (code)`,
  `CREATE TABLE IF NOT EXISTS game_participants (
    id uuid PRIMARY KEY,
    game_id uuid NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    nickname varchar(32) NOT NULL,
    is_bot boolean NOT NULL DEFAULT false,
    color varchar(16) NOT NULL,
    role_id varchar(64) NOT NULL,
    final_rank integer,
    survived_rounds integer NOT NULL DEFAULT 0,
    move_count integer NOT NULL DEFAULT 0,
    skill_use_count integer NOT NULL DEFAULT 0,
    kill_count integer NOT NULL DEFAULT 0,
    water_count integer NOT NULL DEFAULT 0,
    death_round integer,
    death_reason varchar(32),
    initial_position jsonb,
    final_position jsonb,
    updated_at timestamptz NOT NULL
  )`,
  `ALTER TABLE game_participants ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS player_game_results (
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id varchar(64) NOT NULL,
    final_rank integer NOT NULL,
    player_count integer NOT NULL,
    rating double precision NOT NULL,
    kill_count integer NOT NULL DEFAULT 0,
    death_count integer NOT NULL DEFAULT 0,
    won boolean NOT NULL DEFAULT false,
    finished_at timestamptz NOT NULL,
    PRIMARY KEY (game_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS player_game_results_user_idx
    ON player_game_results (user_id)`,
  `INSERT INTO player_game_results (
    game_id,
    user_id,
    role_id,
    final_rank,
    player_count,
    rating,
    kill_count,
    death_count,
    won,
    finished_at
  )
  WITH game_counts AS (
    SELECT game_id, COUNT(*)::double precision AS player_count
    FROM game_participants
    GROUP BY game_id
  )
  SELECT
    participant.game_id,
    participant.user_id,
    participant.role_id,
    participant.final_rank,
    game_counts.player_count::integer,
    (10.0 / game_counts.player_count) *
      (game_counts.player_count - participant.final_rank + 1),
    participant.kill_count,
    CASE WHEN participant.death_reason IS NULL THEN 0 ELSE 1 END,
    participant.final_rank = 1,
    participant.updated_at
  FROM game_participants participant
  JOIN game_counts ON game_counts.game_id = participant.game_id
  WHERE participant.is_bot = false
    AND participant.final_rank IS NOT NULL
  ON CONFLICT (game_id, user_id) DO NOTHING`,
  `DELETE FROM player_game_results
  WHERE user_id NOT IN (SELECT id FROM users)`,
  `CREATE TABLE IF NOT EXISTS game_actions (
    id uuid PRIMARY KEY,
    game_id uuid NOT NULL,
    room_id uuid NOT NULL,
    seq integer NOT NULL,
    round integer,
    participant_id uuid NOT NULL,
    action_type varchar(32) NOT NULL,
    from_position jsonb,
    to_position jsonb,
    direction varchar(32),
    crossed_door boolean NOT NULL DEFAULT false,
    drank boolean NOT NULL DEFAULT false,
    skill_id varchar(64),
    skill_target jsonb,
    killed_participant_ids jsonb NOT NULL,
    died boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_events (
    id uuid PRIMARY KEY,
    game_id uuid NOT NULL,
    room_id uuid NOT NULL,
    seq integer NOT NULL,
    round integer,
    type varchar(64) NOT NULL,
    actor_participant_id uuid,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_snapshots (
    id bigserial PRIMARY KEY,
    room_id uuid NOT NULL,
    game_id uuid,
    seq integer NOT NULL,
    state jsonb NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS game_snapshots_room_seq_idx ON game_snapshots (room_id, seq DESC)`,
  `DELETE FROM game_snapshots older
    USING game_snapshots newer
    WHERE older.room_id = newer.room_id
      AND (
        older.seq < newer.seq
        OR (older.seq = newer.seq AND older.id < newer.id)
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_snapshots_room_unique
    ON game_snapshots (room_id)`,
  `CREATE TABLE IF NOT EXISTS room_messages (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    phrase_id varchar(32) NOT NULL,
    text varchar(32) NOT NULL,
    created_at timestamptz NOT NULL
  )`,
];

export async function initDatabase(): Promise<void> {
  if (config.DATABASE_URL) {
    const pool = new Pool({ connectionString: config.DATABASE_URL });
    db = drizzleNodePg(pool);
    closeDatabase = async () => {
      await pool.end();
    };
  } else {
    if (isProduction) {
      throw new Error("DATABASE_URL is required in production");
    }
    const pglite = new PGlite(config.PGLITE_DATA_DIR);
    await pglite.waitReady;
    db = drizzlePglite(pglite);
    closeDatabase = async () => {
      await pglite.close();
    };
  }

  for (const statement of migrationStatements) {
    await db.execute(sql.raw(statement));
  }
}
