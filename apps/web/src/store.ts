import { create } from "zustand";
import type { PlayerResult, RoomSnapshot } from "@fog-train/shared";
import { api, type ApiUser } from "./api";

interface AuthStore {
  user: ApiUser | null;
  loaded: boolean;
  load: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loaded: false,
  load: async () => {
    const result = await api.me();
    set((state) => ({ user: state.user ?? result.user, loaded: true }));
  },
  setUser: (user) => set({ user, loaded: true }),
  logout: async () => {
    await api.logout();
    set({ user: null });
  },
}));

export interface FeedItem {
  id: string;
  text: string;
  tone: "activity" | "death" | "round" | "phrase";
  createdAt: string;
}

interface RoomStore {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  connectionError: string | null;
  feed: FeedItem[];
  fogAlert: { id: string; nickname: string } | null;
  setSnapshot: (snapshot: RoomSnapshot) => void;
  setConnected: (connected: boolean) => void;
  setConnectionError: (message: string | null) => void;
  pushFeed: (item: Omit<FeedItem, "id" | "createdAt"> & { id?: string }) => void;
  showFogAlert: (nickname: string) => void;
  clearFogAlert: () => void;
  clear: () => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  snapshot: null,
  connected: false,
  connectionError: null,
  feed: [],
  fogAlert: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setConnected: (connected) => set({ connected }),
  setConnectionError: (connectionError) => set({ connectionError }),
  pushFeed: (item) =>
    set((state) => ({
      feed: [
        ...state.feed.slice(-39),
        {
          ...item,
          id: item.id ?? crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
      ],
    })),
  showFogAlert: (nickname) =>
    set({ fogAlert: { id: crypto.randomUUID(), nickname } }),
  clearFogAlert: () => set({ fogAlert: null }),
  clear: () =>
    set({
      snapshot: null,
      connected: false,
      connectionError: null,
      feed: [],
      fogAlert: null,
    }),
}));

export function getLeaderboard(snapshot: RoomSnapshot): PlayerResult[] {
  return snapshot.leaderboard ?? [];
}
