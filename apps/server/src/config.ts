import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16).default("development-session-secret"),
  DATABASE_URL: z.string().optional().default(""),
  PGLITE_DATA_DIR: z.string().default(".pglite"),
  DEFAULT_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  RECONNECT_GRACE_MS: z.coerce.number().int().positive().default(45_000),
  MAX_SPECTATORS: z.coerce.number().int().min(0).default(32),
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === "production";

const developmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const developmentHostSuffixes = [
  ".loca.lt",
  ".serveousercontent.com",
  ".trybore.com",
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (isProduction) return origin === config.PUBLIC_ORIGIN;
  if (origin === config.PUBLIC_ORIGIN || developmentOrigins.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return developmentHostSuffixes.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}
