/**
 * 通用棋盘渲染组件，选位、对局和回放共用。
 *
 * 坐标统一使用 0-based { x, y }，绘制时再转换为百分比位置。
 * 层级约定：格子 < 轨迹 SVG < 雾视/事件标记 < 玩家棋子。
 */
import type {
  BoardMap,
  FogSectionHint,
  Position,
  RoomSnapshot,
} from "@fog-train/shared";
import { positionsEqual, ROLE_REGISTRY } from "@fog-train/shared";

export interface BoardToken {
  id: string;
  participantId: string;
  roleId: string;
  nickname: string;
  color: string;
  position: Position;
  alive: boolean;
  isSelf: boolean;
}

export interface BoardMarker {
  id: string;
  position: Position;
  label: string;
  color: string;
  kind:
    | "death"
    | "kill"
    | "skill"
    | "water"
    | "gunshot"
    | "fog"
    | "hook"
    | "book"
    | "reading";
  title?: string;
  offsetX?: number;
  offsetY?: number;
}

export interface BoardPath {
  participantId: string;
  color: string;
  points: Position[];
}

interface BoardProps {
  map: BoardMap;
  mode: "placement" | "playing" | "replay";
  snapshot?: RoomSnapshot;
  tokens: BoardToken[];
  paintTiles?: Position[];
  markers?: BoardMarker[];
  paths?: BoardPath[];
  onSection?: (sectionId: string) => void;
  onCell?: (position: Position) => void;
  skillTargets?: Position[];
  onSkillTarget?: (position: Position) => void;
  fogPositions?: Position[];
  fogSectionHints?: FogSectionHint[];
  visibleSectionIds?: string[];
}

function tokenPosition(token: BoardToken) {
  const sameCell = 0;
  return {
    left: `${((token.position.x + 0.5) / 3) * 100}%`,
    top: `${((token.position.y + 0.5 + sameCell) / 1) * 100}%`,
  };
}

export function Board({
  map,
  mode,
  snapshot,
  tokens,
  paintTiles,
  markers = [],
  paths = [],
  onSection,
  onCell,
  skillTargets = [],
  onSkillTarget,
  fogPositions = [],
  fogSectionHints = [],
  visibleSectionIds,
}: BoardProps) {
  // snapshot 提供当前对局的公开状态；回放时可通过 paintTiles 等 props 覆盖时间线数据。
  const selectedSectionId =
    mode === "placement" ? snapshot?.placement?.selectedSectionId ?? null : null;
  const occupied = new Set(
    mode === "placement" ? snapshot?.placement?.occupiedSectionIds ?? [] : [],
  );
  const canOperate =
    mode === "placement" &&
    snapshot?.currentActor?.participantId === snapshot?.self?.participantId;
  // 对局视图可由服务端限制为当前玩家附近最多三节；选位和回放继续使用全图。
  const visibleSections = visibleSectionIds?.length
    ? map.sections.filter((section) => visibleSectionIds.includes(section.id))
    : map.sections;
  const firstVisibleY = visibleSections[0]?.startY ?? 0;
  const lastVisibleY =
    visibleSections[visibleSections.length - 1]?.endY ?? map.rows - 1;
  const visibleRowCount = Math.max(1, lastVisibleY - firstVisibleY + 1);
  const isVisibleY = (y: number) => y >= firstVisibleY && y <= lastVisibleY;
  const boardTopPercent = (y: number) => ((y - firstVisibleY + 0.5) / visibleRowCount) * 100;

  const sectionFor = (position: Position) =>
    map.sections.find(
      (section) => position.y >= section.startY && position.y <= section.endY,
    );
  const paintKeys = new Set(
    (paintTiles ?? snapshot?.paintTiles ?? []).map((position) => `${position.x}:${position.y}`),
  );
  const lockedConnections = snapshot?.lockedDoors ?? [];
  const lockLabels = lockedConnections.flatMap((lock) => {
    const lower = map.sections.find((section) => section.id === lock.lowerSectionId);
    return lower
      ? [
          {
            id: lock.connectionId,
            position: { x: 1, y: lower.startY - 0.5 },
          },
        ].filter((label) => isVisibleY(label.position.y))
      : [];
  });
  const aboveHints = fogSectionHints.filter((hint) => hint.direction === "above");
  const belowHints = fogSectionHints.filter((hint) => hint.direction === "below");
  const visibleTokens = tokens.filter((token) => isVisibleY(token.position.y));
  const boardMarkers = ([
    ...markers,
    ...(snapshot?.gunshotSignals ?? []).map((position, index) => ({
      id: `gunshot-${index}-${position.x}:${position.y}`,
      position,
      label: "枪",
      color: "#d9d0c3",
      kind: "gunshot" as const,
      title: "枪声信号",
    })),
    ...(snapshot?.hookSignals ?? []).flatMap((signal) => [
      {
        id: `hook-start-${signal.id}`,
        position: signal.from,
        label: "钩",
        color: signal.color,
        kind: "hook" as const,
        title: "小偷钩子起点",
      },
      {
        id: `hook-end-${signal.id}`,
        position: signal.to,
        label: "落",
        color: signal.color,
        kind: "hook" as const,
        title: "小偷钩子终点",
        offsetX: 10,
      },
    ]),
  ] as BoardMarker[]).filter((marker) => isVisibleY(marker.position.y));
  const visibleFogPositions = fogPositions.filter((position) => isVisibleY(position.y));

  const clickCell = (position: Position) => {
    if (skillTargets.some((target) => positionsEqual(target, position))) {
      onSkillTarget?.(position);
      return;
    }
    if (!canOperate) return;
    const section = sectionFor(position);
    if (!section) return;
    if (!selectedSectionId) {
      if (section.type !== "carriage") return;
      if (occupied.has(section.id)) return;
      onSection?.(section.id);
      return;
    }
    if (section.id !== selectedSectionId) return;
    onCell?.(position);
  };

  return (
    <div
      className="board-frame"
      style={{ "--board-rows": visibleRowCount } as React.CSSProperties}
    >
      {aboveHints.length > 0 && (
        <div className="fog-section-hints fog-section-hints-above" aria-label="上方车厢提示">
          {aboveHints.map((hint) => (
            <span className="fog-section-hint" key={hint.sectionId}>
              上方 · {hint.sectionLabel} · {hint.count}人
            </span>
          ))}
        </div>
      )}
      <div className="board-grid">
        {visibleSections.map((section) => (
          <div
            className={`section-label section-${section.type}`}
            key={`${section.id}-label`}
            style={{
              top: `${((section.startY - firstVisibleY) / visibleRowCount) * 100}%`,
              height: `${((section.endY - section.startY + 1) / visibleRowCount) * 100}%`,
            }}
          >
            <span>{section.label}</span>
          </div>
        ))}

        {Array.from({ length: visibleRowCount }).flatMap((_, rowIndex) => {
          const y = firstVisibleY + rowIndex;
          return (
          Array.from({ length: map.columns }).map((__, x) => {
            const position = { x, y };
            const section = sectionFor(position);
            const isSelectedSection = section?.id === selectedSectionId;
            const isOccupied = section ? occupied.has(section.id) && !isSelectedSection : false;
            const firstInSection = section?.startY === y;
            const isPaint = paintKeys.has(`${x}:${y}`);
            const canPlaceSection =
              !selectedSectionId &&
              section?.type === "carriage" &&
              !occupied.has(section.id);
            const canPlaceCell = Boolean(selectedSectionId && isSelectedSection);
            const canUseSkillTarget = skillTargets.some((target) =>
              positionsEqual(target, position),
            );
            const isInteractive =
              (canOperate && (canPlaceSection || canPlaceCell)) || canUseSkillTarget;
            return (
              <button
                aria-label={`${section?.label ?? "列车"}，第 ${y + 1} 行，第 ${x + 1} 列`}
                className={[
                  "board-cell",
                  section ? `section-${section.type}` : "",
                  firstInSection ? "section-first" : "",
                  isSelectedSection ? "selected-section" : "",
                  isOccupied ? "occupied-section" : "",
                  isPaint ? "paint-tile" : "",
                  isInteractive ? "interactive" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!isInteractive}
                key={`${x}:${y}`}
                onClick={() => clickCell(position)}
                style={{ gridColumn: x + 1, gridRow: rowIndex + 1 }}
                type="button"
              />
            );
          })
          );
        })}

        {paths.length > 0 && (
          <svg
            aria-hidden="true"
            className="board-paths"
            preserveAspectRatio="none"
            viewBox={`0 0 3 ${map.rows}`}
          >
            {paths.map((path) => (
              <polyline
                fill="none"
                key={path.participantId}
                points={path.points
                  .map((point) => `${point.x + 0.5},${point.y + 0.5}`)
                  .join(" ")}
                stroke={path.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.9"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}

        {boardMarkers.map((marker) => (
          <span
            className={`event-marker marker-${marker.kind}`}
            key={marker.id}
            style={{
              left: `${((marker.position.x + 0.5) / 3) * 100}%`,
              top: `${boardTopPercent(marker.position.y)}%`,
              "--marker-color": marker.color,
              "--marker-offset-x": `${marker.offsetX ?? 0}px`,
              "--marker-offset-y": `${marker.offsetY ?? 0}px`,
            } as React.CSSProperties}
            title={marker.title}
          >
            {marker.label}
          </span>
        ))}

        {lockLabels.map((lock) => (
          <span
            className="door-lock-label"
            key={lock.id}
            style={{
              left: "50%",
              top: `${((lock.position.y - firstVisibleY) / visibleRowCount) * 100}%`,
            }}
          >
            锁
          </span>
        ))}

        {visibleTokens.map((token, index) => {
          const samePositionIndex = visibleTokens
            .slice(0, index)
            .filter((candidate) => positionsEqual(candidate.position, token.position)).length;
          return (
            <span
              aria-label={`${token.nickname}${token.alive ? "" : "（已死亡）"}`}
              className={`player-token ${token.isSelf ? "self" : ""} ${token.alive ? "" : "dead"}`}
              data-x={token.position.x}
              data-y={token.position.y}
              key={token.id}
              style={
                {
                  left: `${((token.position.x + 0.5) / 3) * 100}%`,
                  top: `${boardTopPercent(token.position.y)}%`,
                  "--token-color": token.color,
                  "--offset": `${samePositionIndex * 7}px`,
                } as React.CSSProperties
              }
              title={token.nickname}
            >
              {ROLE_REGISTRY[token.roleId as keyof typeof ROLE_REGISTRY]?.symbol ??
                token.nickname.slice(0, 1)}
            </span>
          );
        })}

        {visibleFogPositions.map((position, index) => (
          <span
            className="fog-position-marker"
            key={`fog-${index}-${position.x}:${position.y}`}
            style={
              {
                left: `${((position.x + 0.5) / 3) * 100}%`,
                top: `${boardTopPercent(position.y)}%`,
              } as React.CSSProperties
            }
            title="雾视位置"
          />
        ))}
      </div>
      {belowHints.length > 0 && (
        <div className="fog-section-hints fog-section-hints-below" aria-label="下方车厢提示">
          {belowHints.map((hint) => (
            <span className="fog-section-hint" key={hint.sectionId}>
              下方 · {hint.sectionLabel} · {hint.count}人
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
