import { useEffect } from "react";
import { emitCommand, getSocket } from "../../socket";
import { useRoomStore } from "../../store";

export function useRoomRealtime(roomId: string | undefined) {
  const {
    setSnapshot,
    setConnected,
    setConnectionError,
    pushFeed,
    showFogAlert,
    clearFogAlert,
    clear,
  } = useRoomStore();

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      setConnectionError(null);
      void socket.emitWithAck("room:sync", { roomId }).then((response) => {
        if (!response.ok) setConnectionError(response.message ?? "连接房间失败");
      });
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (error: Error) =>
      setConnectionError(error.message === "UNAUTHORIZED" ? "登录状态已失效" : "实时连接失败");
    const onSnapshot = (snapshot: Parameters<typeof setSnapshot>[0]) => {
      setSnapshot(snapshot);
      localStorage.setItem(
        "fog-train:last-room",
        JSON.stringify({ roomId: snapshot.roomId, roomCode: snapshot.roomCode }),
      );
    };
    const onActivity = (payload: {
      actor: { participantId: string; nickname: string };
      phase: string;
    }) =>
      pushFeed({
        text: `${payload.actor.nickname || "某位乘客"}正在操作中`,
        tone: "activity",
      });
    const onDeath = (payload: { nickname: string }) =>
      pushFeed({
        text: `${payload.nickname}死亡`,
        tone: "death",
      });
    const onRoleSelected = (payload: { nickname: string; roleName: string }) =>
      pushFeed({
        text: `${payload.nickname}选择了角色：${payload.roleName}`,
        tone: "activity",
      });
    const onSkillUsed = (payload: { nickname: string; skillName: string }) =>
      pushFeed({
        text: `${payload.nickname}使用了技能：${payload.skillName}`,
        tone: "activity",
      });
    const onDoorLocked = () =>
      pushFeed({ text: "连接处已被锁住", tone: "activity" });
    const onGunshot = () =>
      pushFeed({ text: "枪声响起", tone: "death" });
    const onFogVisionUsed = (payload: { nickname: string }) =>
      pushFeed({ text: `${payload.nickname}使用了雾视`, tone: "activity" });
    let fogAlertTimer: number | undefined;
    const onFogVisionAlert = (payload: {
      nickname?: string;
      status: "pending" | "resolved" | "ended";
    }) => {
      if (payload.status !== "pending") {
        clearFogAlert();
        return;
      }
      showFogAlert(payload.nickname ?? "有人");
      if (fogAlertTimer) window.clearTimeout(fogAlertTimer);
      fogAlertTimer = undefined;
    };
    const onRoundStarted = (payload: { round: number }) =>
      pushFeed({ text: `第 ${payload.round} 轮开始`, tone: "round" });
    const onRoundEnded = (payload: { round: number }) =>
      pushFeed({ text: `第 ${payload.round} 轮结束`, tone: "round" });
    const onChat = (message: {
      id: string;
      userId: string;
      nickname: string;
      phraseId: string;
      text: string;
      createdAt: string;
    }) => {
      pushFeed({
        id: message.id,
        text: `${message.nickname}：${message.text}`,
        tone: "phrase",
      });
      useRoomStore.setState((state) => {
        if (!state.snapshot) return state;
        if (state.snapshot.messages.some((existing) => existing.id === message.id)) {
          return state;
        }
        return {
          snapshot: {
            ...state.snapshot,
            messages: [...state.snapshot.messages.slice(-49), message],
          },
        };
      });
    };
    const onActionError = (payload: { message: string }) =>
      pushFeed({ text: payload.message, tone: "activity" });
    const onReplaced = () => {
      setConnectionError("该账号已在另一个窗口接管本局");
      socket.disconnect();
    };

    clear();
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:snapshot", onSnapshot);
    socket.on("public:activity", onActivity);
    socket.on("public:death", onDeath);
    socket.on("public:role_selected", onRoleSelected);
    socket.on("public:skill_used", onSkillUsed);
    socket.on("public:door_locked", onDoorLocked);
    socket.on("public:gunshot", onGunshot);
    socket.on("public:fog_vision_used", onFogVisionUsed);
    socket.on("public:fog_vision_alert", onFogVisionAlert);
    socket.on("public:round_started", onRoundStarted);
    socket.on("public:round_ended", onRoundEnded);
    socket.on("room:chat", onChat);
    socket.on("action:error", onActionError);
    socket.on("session:replaced", onReplaced);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:snapshot", onSnapshot);
      socket.off("public:activity", onActivity);
      socket.off("public:death", onDeath);
      socket.off("public:role_selected", onRoleSelected);
      socket.off("public:skill_used", onSkillUsed);
      socket.off("public:door_locked", onDoorLocked);
      socket.off("public:gunshot", onGunshot);
      socket.off("public:fog_vision_used", onFogVisionUsed);
      socket.off("public:fog_vision_alert", onFogVisionAlert);
      socket.off("public:round_started", onRoundStarted);
      socket.off("public:round_ended", onRoundEnded);
      socket.off("room:chat", onChat);
      socket.off("action:error", onActionError);
      socket.off("session:replaced", onReplaced);
      if (fogAlertTimer) window.clearTimeout(fogAlertTimer);
    };
  }, [
    clear,
    clearFogAlert,
    pushFeed,
    roomId,
    setConnected,
    setConnectionError,
    setSnapshot,
    showFogAlert,
  ]);

  return {
    sync: async () => {
      if (!roomId) return;
      await emitCommand("room:sync", {
        commandId: crypto.randomUUID(),
        roomId,
        payload: {},
      });
    },
  };
}
