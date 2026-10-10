import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  Check,
  BookOpen,
  Bot,
  Clipboard,
  Crosshair,
  Crown,
  DoorOpen,
  Droplets,
  Eye,
  Flag,
  Footprints,
  EyeOff,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  MapPinned,
  PaintBucket,
  Play,
  Send,
  Share2,
  ShieldCheck,
  Swords,
  TrainFront,
  Trash2,
  Users,
  LockKeyhole,
} from "lucide-react";
import {
  MAP_REGISTRY,
  BOT_DIFFICULTY_LABELS,
  ROLE_GROUP_LABELS,
  ROLE_GROUP_ORDER,
  ROLE_REGISTRY,
  SKILL_REGISTRY,
  positionsEqual,
  type Direction,
  type Position,
  type RoomSnapshot,
  type SkillId,
  type SkillUseTarget,
  type RoleDefinition,
  type RoleGroupId,
} from "@fog-train/shared";
import { emitCommand, commandEnvelope } from "../../socket";
import { useAuthStore, useRoomStore } from "../../store";
import { Board, type BoardMarker, type BoardToken } from "./Board";
import { ControlPad } from "./ControlPad";
import { useRoomRealtime } from "./useRoomRealtime";
import { ReplayView } from "../replay/ReplayView";
import { GameGuide } from "../guide/GameGuide";
import { AmbientFog } from "../../components/AmbientFog";
import { RoleIcon } from "../../components/RoleIcon";

function Leaderboard({ snapshot }: { snapshot: RoomSnapshot }) {
  const rows = snapshot.leaderboard ?? [];
  return (
    <section className="panel leaderboard-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">本局结束 · {snapshot.mapName}</p>
          <h2>排行榜</h2>
        </div>
        <TrophyMark />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>玩家</th>
              <th>存活轮数</th>
              <th>移动</th>
              <th>技能</th>
              <th>击杀</th>
              <th>喝水</th>
              <th>死亡原因</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.participantId}>
                <td>
                  <span className={`rank-badge rank-${row.finalRank}`}>{row.finalRank}</span>
                </td>
                <td>
                  <span className="player-name-cell">
                    <i style={{ background: row.color }} />
                    <strong>{row.nickname}</strong>
                    {row.isBot && <span className="bot-inline-badge">电脑</span>}
                  </span>
                </td>
                <td>{row.survivedRounds}</td>
                <td>{row.moveCount}</td>
                <td>{row.skillUseCount}</td>
                <td>{row.killCount}</td>
                <td>{row.waterCount}</td>
                <td>{row.deathReason ? deathText(row.deathReason) : "胜利"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrophyMark() {
  return (
    <div className="trophy-mark">
      <span>1</span>
    </div>
  );
}

function deathText(reason: string) {
  return {
    squeeze: "挤压",
    gunshot: "中弹",
    book_impact: "古籍",
    bug_contact: "Bug反噬",
    thirst: "喝水超时",
    disconnect_timeout: "断线超时",
    voluntary_exit: "主动退出",
  }[reason] ?? reason;
}

function LobbyPanel({
  snapshot,
  userId,
  send,
}: {
  snapshot: RoomSnapshot;
  userId: string;
  send: (event: any, payload: any) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const shareUrl = `${window.location.origin}/join/${snapshot.roomCode}`;
  const self = snapshot.members.find((member) => member.userId === userId);
  const isHost = snapshot.hostUserId === userId;
  const players = snapshot.members.filter((member) => member.kind === "player");
  const canStart =
    isHost &&
    players.length >= 2 &&
    players
      .filter((member) => member.userId !== userId)
      .every((member) => member.ready && member.controlState === "active");

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="lobby-layout">
      <section className="room-code-panel">
        <p className="eyebrow">房间码</p>
        <div className="room-code">{snapshot.roomCode}</div>
        <p>发送房间码或邀请链接，让朋友登录后登车。</p>
        <div className="share-row">
          <input aria-label="邀请链接" readOnly value={shareUrl} />
          <button className="secondary" onClick={() => void copy()} type="button">
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <div className="room-meta">
          <span>
            <Users size={16} />
            {players.length}/8 玩家
          </span>
          <span>
            <ShieldCheck size={16} />
            {snapshot.settings.turnTimeoutMs / 1000} 秒行动
          </span>
          <span>
            <MapPinned size={16} />
            {snapshot.mapName}
          </span>
        </div>
      </section>

      <section className="panel lobby-members">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">候车厅</p>
            <h2>乘客与观战者</h2>
          </div>
          <Share2 size={20} />
        </div>
        <div className="member-list">
          {snapshot.members.map((member) => (
            <div
              className={[
                "member-row",
                member.isBot ? "bot-member" : "",
                member.isGoldenBot ? "golden-bot" : "",
                member.isBot && isHost ? "has-remove" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={member.userId}
            >
              {isHost && member.isBot && (
                <button
                  className="member-remove"
                  onClick={() =>
                    void send(
                      "room:remove_bot",
                      commandEnvelope(snapshot.roomId, { botUserId: member.userId }),
                    )
                  }
                  title={`移除${member.nickname}`}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <span className="member-color" style={{ background: member.color }} />
              <div>
                <strong>{member.nickname}</strong>
                {member.isBot && (
                  <span className="bot-inline-badge">
                    {BOT_DIFFICULTY_LABELS[member.botDifficulty ?? "pure_bot"]}
                  </span>
                )}
                <small>
                  {member.isHost && <Crown size={13} />}
                  {member.kind === "spectator" ? "观战者" : "玩家"}
                  {member.controlState === "disconnected" ? " · 重连中" : ""}
                </small>
              </div>
              <span
                className={`ready-dot ${
                  member.kind === "spectator"
                    ? "spectator"
                    : member.ready || member.isHost
                      ? "ready"
                      : ""
                }`}
              >
                {member.kind === "spectator" ? "观" : member.ready || member.isHost ? "已准备" : "等待"}
              </span>
            </div>
          ))}
        </div>
        <ChatBox send={send} snapshot={snapshot} />
        <div className="lobby-actions">
          <GameGuide compact />
          {self && (
            <button
              className="secondary"
              onClick={async () => {
                await send("room:leave", commandEnvelope(snapshot.roomId, {}));
                navigate("/");
              }}
              type="button"
            >
              <LogOut size={17} />
              退出房间
            </button>
          )}
          {!isHost && self?.kind === "player" && (
            <button
              className={self.ready ? "secondary" : "primary"}
              onClick={() =>
                void send("room:ready", {
                  ...commandEnvelope(snapshot.roomId, { ready: !self.ready }),
                })
              }
            >
              {self.ready ? "取消准备" : "准备登车"}
            </button>
          )}
          {isHost && (
            <>
              <button
                className="secondary"
                disabled={players.length >= 8}
                onClick={() =>
                  void send(
                    "room:add_bot",
                    commandEnvelope(snapshot.roomId, { difficulty: "pure_bot" }),
                  )
                }
                type="button"
              >
                <Bot size={17} />
                添加纯入机
              </button>
              <button
                className="secondary"
                disabled={players.length >= 8}
                onClick={() =>
                  void send(
                    "room:add_bot",
                    commandEnvelope(snapshot.roomId, { difficulty: "standard" }),
                  )
                }
                type="button"
              >
                <Bot size={17} />
                添加标准电脑
              </button>
            <button
              className="primary"
              disabled={!canStart}
              onClick={() =>
                void send("room:start", commandEnvelope(snapshot.roomId, {}))
              }
            >
              <Play size={18} />
              开始游戏
            </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function FogDecisionOverlay({
  snapshot,
  send,
}: {
  snapshot: RoomSnapshot;
  send: (event: any, payload: any) => Promise<void>;
}) {
  const [useProphecyBall, setUseProphecyBall] = useState(false);
  const [useInvisibility, setUseInvisibility] = useState(false);
  if (snapshot.fog?.status !== "pending") return null;
  const self = snapshot.self;
  const isCaster = self?.participantId === snapshot.fog.casterParticipantId;
  const canRespond = Boolean(self?.fogVision.canRespond);

  return createPortal(
    <div className="fog-decision-overlay" role="alertdialog" aria-label="雾视处理中">
      <div className="fog-decision-content">
        <Eye size={52} />
        <h2>有人正在进行雾视</h2>
        {isCaster && <p>咒术师正在选择中……</p>}
        {!isCaster && !canRespond && <p>全屏信息已暂时封闭</p>}
        {canRespond && (
          <div className="fog-decision-actions">
            <button
              className={useProphecyBall ? "secondary active" : "secondary"}
              onClick={() => setUseProphecyBall((value) => !value)}
              type="button"
            >
              预言球：{useProphecyBall ? "使用" : "不使用"}
            </button>
            <button
              className={useInvisibility ? "secondary active" : "secondary"}
              disabled={!self?.items.invisibilityCloakAvailable}
              onClick={() => setUseInvisibility((value) => !value)}
              type="button"
            >
              隐身衣：
              {self?.items.invisibilityCloakAvailable
                ? useInvisibility
                  ? "使用"
                  : "不使用"
                : "已使用"}
            </button>
            <button
              className="primary"
              onClick={() =>
                void send(
                  "game:fog_response",
                  commandEnvelope(snapshot.roomId, {
                    useProphecyBall,
                    useInvisibility,
                  }),
                )
              }
              type="button"
            >
              确认选择
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function RolePanel({
  snapshot,
  send,
}: {
  snapshot: RoomSnapshot;
  send: (event: any, payload: any) => Promise<void>;
}) {
  const [lockedRole, setLockedRole] = useState<RoleDefinition | null>(null);
  const [activeGroup, setActiveGroup] = useState<RoleGroupId>("basic");
  const self = snapshot.self;
  const conductorTaken = snapshot.members.some(
    (member) =>
      member.roleId === "conductor" &&
      member.participantId !== self?.participantId,
  );
  const orderedRoles = [...snapshot.roles].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const groupRoles = orderedRoles.filter((role) => role.group === activeGroup);

  const lockReasonFor = (role: RoleDefinition): string | null => {
    if (!role.available) return "该角色尚未开放";
    if (role.requiredMapId && role.requiredMapId !== snapshot.mapId) {
      return `该角色仅可在${MAP_REGISTRY[role.requiredMapId].name}使用`;
    }
    return null;
  };

  const renderRoleCard = (role: RoleDefinition) => {
    const conductorUnavailable = role.id === "conductor" && conductorTaken;
    const selected = snapshot.selectedRoleId === role.id;
    const lockReason = lockReasonFor(role);
    const disabled = Boolean(snapshot.selectedRoleId) || conductorUnavailable;
    const locked = Boolean(lockReason);
    return (
      <button
        className={[
          "role-card",
          selected ? "selected" : "",
          locked ? "locked" : "",
          conductorUnavailable ? "unavailable" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={!locked && disabled}
        key={role.id}
        onClick={() => {
          if (lockReason) {
            setLockedRole(role);
            return;
          }
          if (!disabled) {
            void send(
              "role:select",
              commandEnvelope(snapshot.roomId, { roleId: role.id }),
            );
          }
        }}
        type="button"
      >
        <div className="role-card-head">
          <RoleIcon
            className={`role-symbol role-symbol-${role.id}`}
            icon={role.icon}
            symbol={role.symbol}
          />
          <span className={`role-card-status ${role.available ? "open" : "locked"}`}>
            {lockReason && role.available ? "地图限定" : role.available ? "已开放" : "未开放"}
          </span>
        </div>
        <strong>{role.name}</strong>
        <small className="role-positioning">定位：{role.positioning || "暂无"}</small>
        <p>{role.description || "暂无"}</p>
        {selected && <span className="selected-label">已选择</span>}
        {conductorUnavailable && (
          <span className="unavailable-label">本局已有列车长</span>
        )}
        {lockReason && role.requiredMapId && (
          <span className="unavailable-label">地图限定</span>
        )}
      </button>
    );
  };

  return (
    <section className="panel role-panel">
      <p className="eyebrow">角色选择</p>
      <h2>选择本局身份</h2>
      <div className="role-tabs segmented" role="tablist" aria-label="角色分组">
        {ROLE_GROUP_ORDER.map((group) => (
          <button
            aria-selected={activeGroup === group}
            className={activeGroup === group ? "active" : ""}
            key={group}
            onClick={() => setActiveGroup(group)}
            role="tab"
            type="button"
          >
            {ROLE_GROUP_LABELS[group]}
          </button>
        ))}
      </div>
      <div className="role-group">
        <div className="role-group-heading">
          <strong>{ROLE_GROUP_LABELS[activeGroup]}</strong>
          <span>{groupRoles.length} 名角色</span>
        </div>
        <div className="role-grid">{groupRoles.map(renderRoleCard)}</div>
      </div>
      <div className="waiting-line">
        {snapshot.currentActor ? (
          <>
            <LoaderCircle className="spin" size={18} />
            {snapshot.currentActor.nickname}正在操作中
          </>
        ) : (
          "等待其他玩家确认角色"
        )}
      </div>
      <div className="role-guide-entry">
        <GameGuide compact />
      </div>
      {lockedRole && (
        <div
          className="role-lock-overlay"
          role="presentation"
          onMouseDown={() => setLockedRole(null)}
        >
          <section
            aria-label="角色尚未开放"
            aria-modal="true"
            className="role-lock-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <RoleIcon
              className={`role-symbol role-symbol-${lockedRole.id}`}
              icon={lockedRole.icon}
              symbol={lockedRole.symbol}
            />
            <div>
              <p className="eyebrow">未开放角色</p>
              <h3>{lockedRole.name}</h3>
              <p>{lockReasonFor(lockedRole) ?? "该角色尚未开放"}</p>
            </div>
            <button className="secondary" onClick={() => setLockedRole(null)} type="button">
              知道了
            </button>
          </section>
        </div>
      )}
    </section>
  );
}

function GameHud({ snapshot }: { snapshot: RoomSnapshot }) {
  const isCorpse = snapshot.self?.roleId === "corpse";
  return (
    <div className="game-hud">
      <div>
        <small>全局轮次</small>
        <strong>{snapshot.currentRound}</strong>
      </div>
      <div>
        <small>剩余人数</small>
        <strong>{snapshot.aliveCount}</strong>
      </div>
      <div>
        <small>喝水倒计时</small>
        <strong className={!isCorpse && snapshot.self && snapshot.self.waterCountdown <= 2 ? "danger" : ""}>
          <Droplets size={17} />
          {isCorpse ? "免渴" : snapshot.self?.waterCountdown ?? "-"}
        </strong>
      </div>
      <div>
        <small>当前行动</small>
        <strong>{snapshot.currentActor?.nickname ?? "轮次切换中"}</strong>
      </div>
    </div>
  );
}

function Feed({ items }: { items: ReturnType<typeof useRoomStore.getState>["feed"] }) {
  return (
    <section className="panel feed-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">公开信息</p>
          <h2>列车广播</h2>
        </div>
        <MessageSquareText size={20} />
      </div>
      <div className="feed-list">
        {items.length === 0 && <p className="muted">暂时没有新的广播</p>}
        {[...items].reverse().map((item) => (
          <div className={`feed-item ${item.tone}`} key={item.id}>
            <span />
            <p>{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChatBox({
  snapshot,
  send,
}: {
  snapshot: RoomSnapshot;
  send: (event: any, payload: any) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const canChat = !snapshot.spectatorMap;

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [snapshot.messages]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || !canChat) return;
    setText("");
    void send("room:chat", commandEnvelope(snapshot.roomId, { text: content }));
  };

  return (
    <section className="panel chat-panel">
      <div className="chat-heading">
        <MessageSquareText size={18} />
        <strong>实时对话框</strong>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {snapshot.messages.length === 0 && <p className="muted">暂无消息</p>}
        {snapshot.messages.map((message) => (
          <div className="chat-message" key={message.id}>
            <strong>{message.nickname}</strong>
            <span>{message.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          aria-label="聊天内容"
          disabled={!canChat}
          maxLength={120}
          onChange={(event) => setText(event.target.value)}
          placeholder={canChat ? "输入消息" : "观战者只读"}
          value={text}
        />
        <button className="icon-button" disabled={!canChat || !text.trim()} title="发送" type="submit">
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}

function ReadingTargetDialog({
  snapshot,
  onClose,
  onSelect,
}: {
  snapshot: RoomSnapshot;
  onClose: () => void;
  onSelect: (participantId: string) => void;
}) {
  const selfId = snapshot.self?.participantId;
  const targets = snapshot.members.filter(
    (member) =>
      member.kind === "player" &&
      member.controlState !== "dead" &&
      member.participantId &&
      member.participantId !== selfId,
  );
  return (
    <div className="reading-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="选择阅读目标"
        aria-modal="true"
        className="reading-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">古籍阅读</p>
            <h3>选择要定位的玩家</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" type="button">
            ×
          </button>
        </div>
        <div className="reading-targets">
          {targets.map((target) => (
            <button
              className="secondary"
              key={target.userId}
              onClick={() => {
                onSelect(target.participantId!);
                onClose();
              }}
              type="button"
            >
              {target.nickname}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SkillPanel({
  snapshot,
  onUse,
  onUseFogVision,
  onReadBook,
  targeting,
  setTargeting,
}: {
  snapshot: RoomSnapshot;
  onUse: (skillId: SkillId, target: SkillUseTarget) => void;
  onUseFogVision: () => void;
  onReadBook: (targetParticipantId: string) => void;
  targeting: "none" | "direction" | "cell" | "book_throw";
  setTargeting: (
    targeting: "none" | "direction" | "cell" | "book_throw",
  ) => void;
}) {
  // 技能按钮始终渲染；未轮到时只做禁用，避免界面突然出现或消失。
  const [readingOpen, setReadingOpen] = useState(false);
  const self = snapshot.self;
  if (!self) return null;
  const role = snapshot.roles.find((candidate) => candidate.id === self.roleId);
  const skillId = self.skill.skillIds[0];
  const skill = skillId ? SKILL_REGISTRY[skillId] : null;
  const bookCount = self.items.bookIds.length;

  return (
    <section className="panel skill-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">当前角色</p>
          <h2>{role?.name ?? "角色"}</h2>
        </div>
        {role?.id === "hunter" ? (
          <Crosshair size={20} />
        ) : role?.id === "conductor" ? (
          <LockKeyhole size={20} />
        ) : role?.id === "painter" ? (
          <PaintBucket size={20} />
        ) : role?.id === "thief" ? (
          <Footprints size={20} />
        ) : role?.id === "sorcerer" ? (
          <EyeOff size={20} />
        ) : role?.id === "archaeologist" ? (
          <BookOpen size={20} />
        ) : null}
      </div>
      <div className="skill-inventory">
        {role?.id === "hunter" && <span>子弹 {self.skill.ammo}</span>}
        {role?.id === "thief" && <span>钩子 {self.skill.ammo}/1</span>}
        {role?.id === "painter" && <span>白漆 {self.skill.paintUsesRemaining}</span>}
        {role?.id === "conductor" && <span>锁门 {self.skill.lockUsesRemaining}</span>}
        {role?.id === "traveler" && (
          <span>背包 {self.items.hasBackpack ? "可用" : "已失去"}</span>
        )}
        {role?.id === "sorcerer" && (
          <>
            <span>预言球 可用</span>
            <span>隐身衣 {self.items.invisibilityCloakAvailable ? "可用" : "已用"}</span>
          </>
        )}
        {bookCount > 0 && <span>古籍 {bookCount}</span>}
        {role?.id === "archaeologist" && (
          <span>阅读次数 {self.items.readUsesRemaining}</span>
        )}
        <span>雾视 {self.roleId === "corpse" ? "不可用" : self.fogVision.usesRemaining}</span>
        {self.skill.paintSpreadRoundsRemaining > 0 && (
          <strong>沾漆：剩余 {self.skill.paintSpreadRoundsRemaining} 回合</strong>
        )}
      </div>
      {skill ? (
        <button
          className="primary skill-button"
          disabled={!self.skill.canUseSkill}
          onClick={() => {
            if (skill.id === "hunter_shoot") {
              setTargeting(targeting === "direction" ? "none" : "direction");
            } else if (skill.id === "painter_paint" || skill.id === "thief_hook") {
              setTargeting(targeting === "cell" ? "none" : "cell");
            } else {
              onUse(skill.id, { kind: "none" });
            }
          }}
          title={self.skill.unavailableReason ?? skill.description}
        >
          {skill.name}
        </button>
      ) : (
        <p className="muted">本角色没有主动技能</p>
      )}
      {bookCount > 0 && (
        <button
          className="primary skill-button"
          disabled={!self.isCurrentTurn}
          onClick={() =>
            setTargeting(targeting === "book_throw" ? "none" : "book_throw")
          }
          type="button"
        >
          投书
        </button>
      )}
      {role?.id === "archaeologist" &&
        bookCount > 0 &&
        self.items.readUsesRemaining > 0 && (
          <button
            className="secondary skill-button"
            disabled={!self.isCurrentTurn}
            onClick={() => setReadingOpen(true)}
            type="button"
          >
            阅读
          </button>
        )}
      <button
        className="secondary skill-button"
        disabled={!self.fogVision.canUse}
        onClick={onUseFogVision}
        title={self.fogVision.unavailableReason ?? "标记所有玩家当前的位置"}
        type="button"
      >
        雾视
      </button>
      {targeting === "direction" && <p className="skill-hint">选择上下左右方向</p>}
      {targeting === "cell" && role?.id === "thief" && (
        <p className="skill-hint">选择当前区域内的格子</p>
      )}
      {targeting === "cell" && role?.id === "painter" && (
        <p className="skill-hint">选择 3×3 范围内的格子</p>
      )}
      {targeting === "book_throw" && (
        <p className="skill-hint">选择投书方向，古籍最多飞行 3 格</p>
      )}
      {self.skill.unavailableReason && <p className="muted">{self.skill.unavailableReason}</p>}
      {readingOpen && (
        <ReadingTargetDialog
          onClose={() => setReadingOpen(false)}
          onSelect={onReadBook}
          snapshot={snapshot}
        />
      )}
    </section>
  );
}

export function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { snapshot, connected, connectionError, feed, pushFeed } = useRoomStore();
  const [skillTargeting, setSkillTargeting] = useState<
    "none" | "direction" | "cell" | "book_throw"
  >("none");
  const { sync } = useRoomRealtime(roomId);

  const send = async (event: any, payload: any) => {
    const ack = await emitCommand(event, payload);
    if (!ack.ok) pushFeed({ text: ack.message ?? "操作失败", tone: "activity" });
  };

  const tokens = useMemo<BoardToken[]>(() => {
    // 存活玩家只渲染自己；死亡玩家或观战者才使用服务器下发的全量 players。
    if (!snapshot) return [];
    if (snapshot.spectatorMap && snapshot.players) {
      return snapshot.players
        .filter((player) => player.position.x >= 0 && player.position.y >= 0)
        .map((player) => ({
          id: player.participantId,
          participantId: player.participantId,
          roleId: player.roleId,
          nickname: player.nickname,
          color: player.color,
          position: player.position,
          alive: player.alive,
          isSelf: player.participantId === snapshot.self?.participantId,
        }));
    }
    if (!snapshot.self?.position) return [];
    return [
      {
        id: snapshot.self.participantId,
        participantId: snapshot.self.participantId,
        roleId: snapshot.self.roleId,
        nickname: user?.nickname ?? "我",
        color: snapshot.members.find((member) => member.userId === user?.id)?.color ?? "#4c78a8",
        position: snapshot.self.position,
        alive: true,
        isSelf: true,
      },
    ];
  }, [snapshot, user]);

  useEffect(() => {
    if (!snapshot?.self?.isCurrentTurn) setSkillTargeting("none");
  }, [snapshot?.self?.isCurrentTurn]);

  if (!snapshot) {
    return (
      <main className="center-page">
        <div className="join-state">
          <LoaderCircle className="spin" size={30} />
          <p>{connectionError ?? "正在同步房间状态..."}</p>
          {connectionError && (
            <button className="secondary" onClick={() => void sync()}>
              重试
            </button>
          )}
        </div>
      </main>
    );
  }

  const canControl =
    snapshot.phase === "playing" &&
    Boolean(snapshot.self?.isCurrentTurn) &&
    !snapshot.spectatorMap;

  const chooseSection = (sectionId: string) =>
    void send(
      "placement:choose_section",
      commandEnvelope(snapshot.roomId, { sectionId }),
    );
  const chooseCell = (position: Position) =>
    void send(
      "placement:choose_cell",
      commandEnvelope(snapshot.roomId, { position }),
    );
  const move = (direction: Direction) =>
    void send("game:move", commandEnvelope(snapshot.roomId, { direction }));
  const useGameSkill = (skillId: SkillId, target: SkillUseTarget) =>
    void send(
      "game:skill_use",
      commandEnvelope(snapshot.roomId, { skillId, target }),
    );
  const useFogVision = () =>
    void send("game:fog_vision", commandEnvelope(snapshot.roomId, {}));
  const readBook = (targetParticipantId: string) =>
    void send(
      "game:book_read",
      commandEnvelope(snapshot.roomId, { targetParticipantId }),
    );
  const fogPositions = snapshot.self?.fogVision.revealedPositions ?? [];
  const fogSectionHints = snapshot.self?.fogVision.sectionHints ?? [];
  const visibleSectionIds = snapshot.spectatorMap
    ? undefined
    : snapshot.self?.visibleSectionIds;
  const privateMarkers: BoardMarker[] = [
    ...(snapshot.self?.items.bookMarkers ?? []).map((marker) => ({
      id: `book-${marker.id}`,
      position: marker.position,
      label: "书",
      color: "#d8b06c",
      kind: "book" as const,
      title: marker.title,
    })),
    ...(snapshot.self?.items.readingMark
      ? [
          {
            id: `reading-${snapshot.self.items.readingMark.targetParticipantId}`,
            position: snapshot.self.items.readingMark.position,
            label:
              ROLE_REGISTRY[
                snapshot.self.items.readingMark.roleId as keyof typeof ROLE_REGISTRY
              ]?.symbol ?? "读",
            color: "#c993e8",
            kind: "reading" as const,
            title: `阅读：${snapshot.self.items.readingMark.nickname}`,
          },
        ]
      : []),
  ];
  let cellSkillTargets: Position[] = [];
  if (
    skillTargeting === "cell" &&
    snapshot.self?.isCurrentTurn &&
    snapshot.self.skill.canUseSkill &&
    snapshot.self.position &&
    snapshot.map
  ) {
    const origin = snapshot.self.position;
    const section = snapshot.map.sections.find(
      (candidate) => origin.y >= candidate.startY && origin.y <= candidate.endY,
    );
    if (snapshot.self.roleId === "painter") {
      cellSkillTargets = Array.from({ length: 3 }).flatMap((_, rowOffset) =>
        Array.from({ length: 3 }).flatMap((__, columnOffset) => {
          const position = {
            x: origin.x + columnOffset - 1,
            y: origin.y + rowOffset - 1,
          };
          if (
            position.x < 0 ||
            position.x >= snapshot.map!.columns ||
            position.y < 0 ||
            position.y >= snapshot.map!.rows
          ) {
            return [];
          }
          return [position];
        }),
      );
    } else if (snapshot.self.roleId === "thief" && section) {
      cellSkillTargets = Array.from(
        { length: (section.endY - section.startY + 1) * snapshot.map.columns },
        (_, index) => ({
          x: index % snapshot.map!.columns,
          y: section.startY + Math.floor(index / snapshot.map!.columns),
        }),
      ).filter((position) => !positionsEqual(position, origin));
    }
  }

  const fogVisionActive = snapshot.fog?.status === "pending";

  return (
    <main className={`game-shell ${fogVisionActive ? "fog-vision-active" : ""}`}>
      <AmbientFog />
      <FogDecisionOverlay send={send} snapshot={snapshot} />
      {fogVisionActive && <div className="fog-vision-clear" aria-hidden="true" />}
      <header className="topbar game-topbar">
        <div className="brand">
          <TrainFront size={20} />
          <strong>房间 {snapshot.roomCode}</strong>
        </div>
        <div className="room-status">
          <span className={`connection-dot ${connected ? "online" : ""}`} />
          {connected ? "实时连接" : "重连中"}
          <button
            className="icon-button"
            onClick={() => {
              void send("room:leave", commandEnvelope(snapshot.roomId, {})).then(() =>
                navigate("/"),
              );
            }}
            title="退出房间"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {snapshot.phase === "lobby" && user && (
        <LobbyPanel snapshot={snapshot} send={send} userId={user.id} />
      )}

      {snapshot.phase === "role_select" && (
        <div className="role-phase-layout">
          <RolePanel send={send} snapshot={snapshot} />
          <Feed items={feed} />
        </div>
      )}

      {(snapshot.phase === "placement" || snapshot.phase === "playing") && snapshot.map && (
        <div className="game-layout">
          <section className="game-main">
            {snapshot.phase === "playing" && <GameHud snapshot={snapshot} />}
            <div className="activity-banner">
              {snapshot.currentActor ? (
                <>
                  <span className="pulse-dot" />
                  <strong>{snapshot.currentActor.nickname}</strong> 正在操作中
                </>
              ) : (
                "正在切换行动者"
              )}
            </div>
            <Board
              map={snapshot.map}
              mode={snapshot.phase === "placement" ? "placement" : "playing"}
              onCell={chooseCell}
              onSkillTarget={(position) => {
                useGameSkill(
                  snapshot.self?.roleId === "thief" ? "thief_hook" : "painter_paint",
                  { kind: "cell", position },
                );
                setSkillTargeting("none");
              }}
              onSection={chooseSection}
              fogPositions={fogPositions}
              fogSectionHints={fogSectionHints}
              markers={privateMarkers}
              skillTargets={cellSkillTargets}
              snapshot={snapshot}
              tokens={tokens}
              {...(visibleSectionIds ? { visibleSectionIds } : {})}
            />
            <ControlPad
              disabled={!canControl || skillTargeting === "cell"}
              legalMoves={
                skillTargeting === "direction" || skillTargeting === "book_throw"
                  ? ["up", "right", "down", "left"]
                  : snapshot.self?.legalMoves ?? []
              }
              onMove={(direction) => {
                if (skillTargeting === "book_throw") {
                  void send(
                    "game:book_throw",
                    commandEnvelope(snapshot.roomId, { direction }),
                  );
                  setSkillTargeting("none");
                } else if (skillTargeting === "direction") {
                  useGameSkill("hunter_shoot", { kind: "direction", direction });
                  setSkillTargeting("none");
                } else {
                  move(direction);
                }
              }}
            />
          </section>

          <aside className="game-sidebar">
            <section className="panel order-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">固定顺序</p>
                  <h2>行动队列</h2>
                </div>
                <Swords size={20} />
              </div>
              <ol className="turn-order">
                {snapshot.turnOrder.map((actor, index) => {
                  const member = snapshot.members.find(
                    (candidate) => candidate.participantId === actor.participantId,
                  );
                  return (
                    <li
                      className={[
                        snapshot.currentActor?.participantId === actor.participantId ? "current" : "",
                        member?.controlState === "dead" ? "dead" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={actor.participantId}
                    >
                      <span>{index + 1}</span>
                      <i style={{ background: member?.color }} />
                      <strong>{actor.nickname}</strong>
                    </li>
                  );
                })}
              </ol>
            </section>
            {snapshot.canEndBotOnlyGame && (
              <button
                className="secondary end-bot-game-button"
                onClick={() =>
                  void send(
                    "room:end_bot_game",
                    commandEnvelope(snapshot.roomId, {}),
                  )
                }
                type="button"
              >
                <Flag size={18} />
                结束机器人对局
              </button>
            )}
            <Feed items={feed} />
            {snapshot.phase === "playing" && (
              <SkillPanel
                onReadBook={readBook}
                onUse={useGameSkill}
                onUseFogVision={useFogVision}
                setTargeting={setSkillTargeting}
                snapshot={snapshot}
                targeting={skillTargeting}
              />
            )}
            <ChatBox send={send} snapshot={snapshot} />
          </aside>
        </div>
      )}

      {snapshot.phase === "finished" && (
        <div className="finish-layout">
          <Leaderboard snapshot={snapshot} />
          <ReplayView embedded roomCode={snapshot.roomCode} />
          <div className="finish-actions">
            <button
              className="primary"
              onClick={() =>
                void send("room:rematch", commandEnvelope(snapshot.roomId, {}))
              }
            >
              <Play size={18} />
              回到房间
            </button>
            <button className="secondary" onClick={() => navigate("/")}>
              <DoorOpen size={18} />
              返回车站
            </button>
          </div>
        </div>
      )}

      {connectionError && <div className="connection-toast">{connectionError}</div>}
    </main>
  );
}
