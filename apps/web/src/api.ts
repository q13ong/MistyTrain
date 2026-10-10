import type {
  LeaderboardEntry,
  MapId,
  ReplayPayload,
} from "@fog-train/shared";

export interface ApiUser {
  id: string;
  email: string;
  nickname: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? "请求失败");
  }
  return body as T;
}

export const api = {
  me: () => request<{ user: ApiUser | null }>("/api/auth/me"),
  register: (data: { email: string; nickname: string; password: string }) =>
    request<{ user: ApiUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ user: ApiUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  leaderboard: () =>
    request<{ entries: LeaderboardEntry[] }>("/api/leaderboard"),
  createRoom: (mapId: MapId) =>
    request<{ roomId: string; roomCode: string; shareUrl: string }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ mapId }),
    }),
  room: (code: string) =>
    request<{
      roomId: string;
      roomCode: string;
      status: string;
      playerCount: number;
      spectatorCount: number;
      canJoinAsPlayer: boolean;
      canJoinAsSpectator: boolean;
    }>(`/api/rooms/${encodeURIComponent(code)}`),
  joinRoom: (code: string) =>
    request<{ roomId: string; roomCode: string; kind: "player" | "spectator" }>(
      `/api/rooms/${encodeURIComponent(code)}/join`,
      { method: "POST" },
    ),
  replay: (code: string) =>
    request<ReplayPayload>(`/api/rooms/${encodeURIComponent(code)}/replay`),
};
