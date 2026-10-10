/**
 * 赛后轨迹回放。
 *
 * 回放不依赖实时房间状态，而是从服务器的事件流重建每个轮次：
 * - 移动事件生成代表色轨迹；
 * - 死亡、击杀、技能、枪声和雾视事件生成节点；
 * - 白漆事件按轮次累加，拖动时间轴即可一步一步查看扩散。
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { PlayerResult, Position, ReplayPayload } from "@fog-train/shared";
import { api } from "../../api";
import {
  Board,
  type BoardMarker,
  type BoardPath,
  type BoardToken,
} from "../game/Board";

function participantInitial(participant: PlayerResult): Position | null {
  return participant.initialPosition;
}

export function ReplayView({
  payload,
  embedded = false,
  roomCode,
}: {
  payload?: ReplayPayload;
  embedded?: boolean;
  roomCode?: string;
}) {
  const code = roomCode ?? payload?.roomCode;
  const query = useQuery({
    queryKey: ["replay", code],
    queryFn: () => api.replay(code!),
    enabled: Boolean(code),
  });
  const replay = payload ?? query.data;
  const maxRound = useMemo(() => {
    if (!replay) return 0;
    return Math.max(
      0,
      ...replay.actions.map((action) => action.round ?? 0),
      ...replay.events.map((event) => event.round ?? 0),
    );
  }, [replay]);
  const [round, setRound] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // 默认展示终局快照；用户点击播放时会从第 0 轮重新播放。
  const currentRound = round ?? maxRound;

  useEffect(() => {
    if (!replay || round !== null) return;
    setRound(maxRound);
  }, [maxRound, replay, round]);

  useEffect(() => {
    if (!playing || !replay || round === null) return;
    const timer = window.setInterval(() => {
      setRound((current) => {
        const value = current ?? maxRound;
        if (value >= maxRound) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, 1100);
    return () => window.clearInterval(timer);
  }, [maxRound, playing, replay, round]);

  if (query.isLoading && !replay) return <div className="panel-empty">正在载入轨迹...</div>;
  if (query.error && !replay) return <div className="panel-empty">{query.error.message}</div>;
  if (!replay) return null;

  const positions = new Map<string, Position>();
  const paths = new Map<string, Position[]>();
  for (const participant of replay.leaderboard) {
    const initial = participantInitial(participant);
    if (initial) {
      positions.set(participant.participantId, initial);
      paths.set(participant.participantId, [initial]);
    } else {
      paths.set(participant.participantId, []);
    }
  }

  const visibleActions = replay.actions.filter(
    (action) => (action.round ?? 0) <= currentRound,
  );
  const storedMoveActions = visibleActions.filter(
    (action) =>
      (action.actionType === "move" ||
        (action.actionType === "skill" && action.skillId === "thief_hook")) &&
      action.toPosition,
  );
  const eventMoveActions = replay.events
    .filter(
      (event) =>
        event.type === "actor_moved" &&
        (event.round ?? 0) <= currentRound &&
        event.payload.to,
    )
    .map((event) => ({
      id: event.id,
      round: event.round,
      participantId: String(event.payload.participantId),
      toPosition: event.payload.to as Position,
      drank: Boolean(event.payload.drank),
      killedParticipantIds: [] as string[],
    }));
  const movementTimeline =
    storedMoveActions.length > 0 ? storedMoveActions : eventMoveActions;

  for (const action of movementTimeline) {
    if (action.toPosition) {
      positions.set(action.participantId, action.toPosition);
      paths.get(action.participantId)?.push(action.toPosition);
    }
  }

  const tokens: BoardToken[] = replay.leaderboard.flatMap((participant) => {
    const position = positions.get(participant.participantId);
    if (!position) return [];
    return [{
      id: participant.participantId,
      participantId: participant.participantId,
      roleId: participant.roleId,
      nickname: participant.nickname,
      color: participant.color,
      position,
      alive: participant.deathRound === null || participant.deathRound > currentRound,
      isSelf: false,
    }];
  });

  const markers: BoardMarker[] = [];
  for (const action of movementTimeline) {
    if (action.drank && action.toPosition) {
      markers.push({
        id: `water-${action.id}`,
        position: action.toPosition,
        label: "水",
        color: "#36a9e1",
        kind: "water",
        title: `第 ${action.round} 轮喝水`,
      });
    }
  }

  for (const action of storedMoveActions) {
    if (action.killedParticipantIds.length > 0 && action.toPosition) {
      const killedNames = action.killedParticipantIds
        .map(
          (participantId) =>
            replay.leaderboard.find((participant) => participant.participantId === participantId)
              ?.nickname ?? "玩家",
        )
        .join("、");
      markers.push({
        id: `kill-${action.id}`,
        position: action.toPosition,
        label: "杀",
        color: "#f0b451",
        kind: "kill",
        title: `第 ${action.round} 轮击杀：${killedNames}`,
        offsetX: -10,
      });
    }
  }
  for (const event of replay.events) {
    if ((event.round ?? 0) > currentRound) continue;
    if (event.type === "death" && event.payload.position) {
      markers.push({
        id: `death-${event.id}`,
        position: event.payload.position as Position,
        label: "死",
        color: "#d94b4b",
        kind: "death",
        title: `第 ${event.round} 轮死亡：${String(event.payload.nickname ?? "玩家")}`,
        offsetX: 10,
      });
      if (storedMoveActions.length === 0 && event.payload.killerParticipantId) {
        markers.push({
          id: `legacy-kill-${event.id}`,
          position: event.payload.position as Position,
          label: "杀",
          color: "#f0b451",
          kind: "kill",
          title: `第 ${event.round} 轮击杀`,
          offsetX: -10,
        });
      }
    }
    if (
      event.type.includes("skill") &&
      event.payload.position &&
      event.payload.skillId !== "thief_hook"
    ) {
      markers.push({
        id: `skill-${event.id}`,
        position: event.payload.position as Position,
        label: "技",
        color: "#9978d1",
        kind: "skill",
        title: `第 ${event.round} 轮使用技能`,
      });
    }
    if (event.type === "gunshot" && event.payload.position) {
      markers.push({
        id: `gunshot-${event.id}`,
        position: event.payload.position as Position,
        label: "枪",
        color: "#ded6c8",
        kind: "gunshot",
        title: `第 ${event.round} 轮枪声信号`,
      });
    }
    if (event.type === "hook_used" && event.payload.signal) {
      const signal = event.payload.signal as {
        id: string;
        participantId: string;
        color: string;
        from: Position;
        to: Position;
      };
      markers.push(
        {
          id: `hook-start-${signal.id}`,
          position: signal.from,
          label: "钩",
          color: signal.color,
          kind: "hook",
          title: `第 ${event.round} 轮钩子起点`,
        },
        {
          id: `hook-end-${signal.id}`,
          position: signal.to,
          label: "落",
          color: signal.color,
          kind: "hook",
          title: `第 ${event.round} 轮钩子终点`,
          offsetX: 10,
        },
      );
    }
    if (event.type === "fog_vision_used" && event.payload.position) {
      markers.push({
        id: `fog-${event.id}`,
        position: event.payload.position as Position,
        label: "雾",
        color: "#b8c4d6",
        kind: "fog",
        title: `第 ${event.round} 轮使用雾视`,
      });
    }
    if (event.type === "fog_resolved" && Array.isArray(event.payload.positions)) {
      (event.payload.positions as Position[]).forEach((position, index) => {
        markers.push({
          id: `fog-result-${event.id}-${index}`,
          position,
          label: "雾",
          color: "#b8c4d6",
          kind: "fog",
          title: `第 ${event.round} 轮雾视位置`,
        });
      });
    }
    if (event.type === "book_thrown" && event.payload.to) {
      markers.push({
        id: `book-${event.id}`,
        position: event.payload.to as Position,
        label: "书",
        color: "#d8b06c",
        kind: "book",
        title: `第 ${event.round} 轮古籍落点`,
      });
    }
    if (event.type === "reading_marked" && event.payload.position) {
      markers.push({
        id: `reading-${event.id}`,
        position: event.payload.position as Position,
        label: "读",
        color: "#c993e8",
        kind: "reading",
        title: `第 ${event.round} 轮阅读标记`,
      });
    }
  }

  const boardPaths: BoardPath[] = replay.leaderboard.map((participant) => ({
    participantId: participant.participantId,
    color: participant.color,
    points: paths.get(participant.participantId) ?? [],
  }));
  const replayPaintTiles = replay.events
    .filter(
      (event) =>
        event.type === "paint_applied" &&
        (event.round ?? 0) <= currentRound &&
        event.payload.position,
    )
    .map((event) => event.payload.position as Position);
  const roundEvents = replay.events.filter((event) => (event.round ?? 0) === currentRound);
  const roundKills = storedMoveActions.filter(
    (action) => action.round === currentRound && action.killedParticipantIds.length > 0,
  );
  const legacyRoundKills = replay.events.filter(
    (event) =>
      storedMoveActions.length === 0 &&
      event.type === "death" &&
      (event.round ?? 0) === currentRound &&
      Boolean(event.payload.killerParticipantId),
  );

  return (
    <div className={`replay-layout ${embedded ? "embedded" : ""}`}>
      <div className="replay-board">
        <Board
          map={replay.map}
          markers={markers}
          mode="replay"
          paintTiles={replayPaintTiles}
          paths={boardPaths}
          tokens={tokens}
        />
      </div>
      <aside className="replay-controls">
        <div className="replay-title">
          <div>
            <p className="eyebrow">轨迹回放 · {replay.mapName || "暂无"}</p>
            <h2>{currentRound === 0 ? "初始位置" : `第 ${currentRound} 轮`}</h2>
          </div>
          <button
            className="icon-button"
            onClick={() => {
              if (!playing && currentRound >= maxRound) setRound(0);
              setPlaying((value) => !value);
            }}
            title={playing ? "暂停" : "播放"}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
        </div>
        <div className="round-stepper">
          <button
            className="icon-button"
            disabled={currentRound <= 0}
            onClick={() => setRound((value) => Math.max(0, (value ?? currentRound) - 1))}
            title="上一轮"
          >
            <ChevronLeft size={18} />
          </button>
          <input
            aria-label="回放轮次"
            max={maxRound}
            min={0}
            onChange={(event) => {
              setPlaying(false);
              setRound(Number(event.target.value));
            }}
            type="range"
            value={currentRound}
          />
          <button
            className="icon-button"
            disabled={currentRound >= maxRound}
            onClick={() =>
              setRound((value) => Math.min(maxRound, (value ?? currentRound) + 1))
            }
            title="下一轮"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="legend-list">
          <div className="legend-row event-legend">
            <span className="legend-marker death">死</span>
            <strong>死亡节点</strong>
            <small>死者位置</small>
          </div>
          <div className="legend-row event-legend">
            <span className="legend-marker kill">杀</span>
            <strong>击杀节点</strong>
            <small>凶手落点</small>
          </div>
          <div className="legend-row event-legend">
            <span className="legend-marker skill">技</span>
            <strong>技能节点</strong>
            <small>技能位置</small>
          </div>
          <div className="legend-row event-legend">
            <span className="legend-marker hook">钩</span>
            <strong>钩子节点</strong>
            <small>起点与终点</small>
          </div>
          <div className="legend-row event-legend">
            <span className="legend-marker book">书</span>
            <strong>古籍落点</strong>
            <small>投掷位置</small>
          </div>
          <div className="legend-row event-legend">
            <span className="legend-marker reading">读</span>
            <strong>阅读标记</strong>
            <small>固定快照</small>
          </div>
          {replay.leaderboard.map((participant) => (
            <div className="legend-row" key={participant.participantId}>
              <span style={{ background: participant.color }} />
              <strong>{participant.nickname}</strong>
              <small>
                {participant.finalRank > 0 ? `第 ${participant.finalRank} 名` : ""}
                {participant.isBot ? " · 电脑" : ""}
              </small>
            </div>
          ))}
        </div>
        <div className="event-list compact">
          {roundEvents.length === 0 && roundKills.length === 0 && legacyRoundKills.length === 0 ? (
            <p className="muted">本轮无特殊事件</p>
          ) : (
            <>
              {roundKills
                .map((action) => {
                  const actor = replay.leaderboard.find(
                    (participant) => participant.participantId === action.participantId,
                  );
                  const killed = action.killedParticipantIds
                    .map(
                      (participantId) =>
                        replay.leaderboard.find(
                          (participant) => participant.participantId === participantId,
                        )?.nickname ?? "玩家",
                    )
                    .join("、");
                  return (
                    <div key={`kill-${action.id}`}>
                      <span>击杀</span>
                      <p>
                        {actor?.nickname ?? "玩家"}击杀{killed}
                      </p>
                    </div>
                  );
                })}
              {legacyRoundKills.map((event) => {
                const killer = replay.leaderboard.find(
                  (participant) =>
                    participant.participantId === String(event.payload.killerParticipantId),
                );
                return (
                  <div key={`legacy-kill-${event.id}`}>
                    <span>击杀</span>
                    <p>
                      {killer?.nickname ?? "玩家"}击杀{String(event.payload.nickname ?? "玩家")}
                    </p>
                  </div>
                );
              })}
              {roundEvents.map((event) => (
                <div key={event.id}>
                  <span>{event.type === "death" ? "死亡" : event.type === "drank" ? "喝水" : "事件"}</span>
                  <p>
                    {event.type === "death"
                      ? `${String(event.payload.nickname)}：${String(event.payload.publicReason ?? "")}`
                      : JSON.stringify(event.payload)}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
