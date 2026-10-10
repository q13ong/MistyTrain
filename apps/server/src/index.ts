import { config } from "./config";
import { closeDatabase, initDatabase } from "./db/client";
import { buildApp } from "./http/routes";
import { RoomService } from "./rooms/service";
import { attachRealtime } from "./realtime/hub";
import { BotController } from "./bots/controller";

await initDatabase();

const roomService = new RoomService(
  {
    turnTimeoutMs: config.DEFAULT_TURN_TIMEOUT_MS,
    reconnectGraceMs: config.RECONNECT_GRACE_MS,
    maxSpectators: config.MAX_SPECTATORS,
  },
  () => undefined,
);
  await roomService.initialize();
const botController = new BotController(roomService);
roomService.setBotController(botController);
for (const room of roomService.getLoadedRooms()) {
  botController.schedule(room);
}

const app = buildApp(roomService);
const io = attachRealtime(app.server, roomService, config.PUBLIC_ORIGIN);

await app.listen({ host: config.HOST, port: config.PORT });

const shutdown = async () => {
  io.close();
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
