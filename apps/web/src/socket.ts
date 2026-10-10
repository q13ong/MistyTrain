import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  CommandAck,
  CommandEnvelope,
  ServerToClientEvents,
} from "@fog-train/shared";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      transports: ["polling", "websocket"],
    });
  }
  return socket;
}

export async function emitCommand<K extends keyof ClientToServerEvents>(
  event: K,
  payload: CommandEnvelope<any>,
): Promise<CommandAck> {
  const appSocket = getSocket();
  return (appSocket as any).emitWithAck(event, payload) as Promise<CommandAck>;
}

export function commandEnvelope<T>(
  roomId: string,
  payload: T,
  turnId?: string,
): CommandEnvelope<T> {
  return {
    commandId: crypto.randomUUID(),
    roomId,
    ...(turnId ? { turnId } : {}),
    payload,
  };
}
