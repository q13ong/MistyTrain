import { useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Crosshair,
  Droplets,
  Eye,
  Footprints,
  LockKeyhole,
  PaintBucket,
  TrainFront,
  Users,
  X,
} from "lucide-react";
import {
  ROLE_REGISTRY,
  ROLE_HUNTER,
  SKILL_REGISTRY,
  type RoleId,
} from "@fog-train/shared";
import { RoleIcon } from "../../components/RoleIcon";

type GuideTab = "basics" | "roles";

function TrainOverviewDiagram() {
  return (
    <svg viewBox="0 0 260 170" role="img" aria-label="列车地图示意图">
      <rect x="82" y="8" width="96" height="34" rx="5" className="guide-svg-soft" />
      <text x="130" y="30" textAnchor="middle" className="guide-svg-label">车头</text>
      <rect x="82" y="48" width="96" height="54" rx="5" className="guide-svg-carriage" />
      <text x="130" y="78" textAnchor="middle" className="guide-svg-label">车厢</text>
      <path d="M114 48v54M146 48v54M82 75h96" className="guide-svg-line" />
      <rect x="82" y="108" width="96" height="36" rx="5" className="guide-svg-soft" />
      <text x="130" y="130" textAnchor="middle" className="guide-svg-label">储物间</text>
      <path d="M82 43h96M82 103h96" className="guide-svg-door" />
      {[0, 1, 2].map((column) => (
        <text key={column} x={[114, 130, 146][column]} y="22" textAnchor="middle" className="guide-svg-door-label">
          门
        </text>
      ))}
    </svg>
  );
}

function MoveDiagram() {
  const positions = [
    [34, 34], [80, 34], [126, 34],
    [34, 80], [126, 80],
    [34, 126], [80, 126], [126, 126],
  ];
  return (
    <svg viewBox="0 0 160 160" role="img" aria-label="八方向移动示意图">
      <rect x="58" y="58" width="44" height="44" rx="7" className="guide-svg-carriage" />
      <circle cx="80" cy="80" r="10" className="guide-svg-player" />
      <text x="80" y="84" textAnchor="middle" className="guide-svg-player-text">我</text>
      {positions.map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r="13" className="guide-svg-target" />
          <path d={`M80 80 L${x} ${y}`} className="guide-svg-arrow" />
        </g>
      ))}
    </svg>
  );
}

function SqueezeDiagram() {
  return (
    <svg viewBox="0 0 220 150" role="img" aria-label="挤压移动示意图">
      <rect x="18" y="28" width="184" height="94" rx="8" className="guide-svg-carriage" />
      <path d="M91 28v94M128 28v94" className="guide-svg-line" />
      <circle cx="92" cy="75" r="17" className="guide-svg-player" />
      <text x="92" y="80" textAnchor="middle" className="guide-svg-player-text">A</text>
      <circle cx="128" cy="75" r="17" className="guide-svg-danger" />
      <text x="128" y="80" textAnchor="middle" className="guide-svg-player-text">B</text>
      <path d="M105 75h16" className="guide-svg-danger-arrow" />
      <text x="148" y="71" className="guide-svg-danger-text">挤压</text>
    </svg>
  );
}

function WaterDiagram() {
  return (
    <svg viewBox="0 0 220 150" role="img" aria-label="喝水机制示意图">
      <rect x="22" y="42" width="78" height="64" rx="7" className="guide-svg-carriage" />
      <rect x="120" y="42" width="78" height="64" rx="7" className="guide-svg-carriage" />
      <text x="61" y="77" textAnchor="middle" className="guide-svg-label">车厢 A</text>
      <text x="159" y="77" textAnchor="middle" className="guide-svg-label">车厢 B</text>
      <path d="M100 42v64" className="guide-svg-door" />
      <circle cx="86" cy="74" r="11" className="guide-svg-player" />
      <path d="M98 74h26" className="guide-svg-arrow" />
      <Droplets x="105" y="103" width="22" height="22" className="guide-svg-icon" />
    </svg>
  );
}

function FogVisionDiagram() {
  return (
    <svg viewBox="0 0 220 150" role="img" aria-label="雾视示意">
      <rect x="22" y="32" width="176" height="86" rx="8" className="guide-svg-carriage" />
      <path d="M22 58h176M22 92h176" className="guide-svg-fog-line" />
      <circle cx="62" cy="64" r="10" className="guide-svg-player" />
      <circle cx="110" cy="84" r="10" className="guide-svg-danger" />
      <circle cx="158" cy="62" r="10" className="guide-svg-player" />
      <path d="M54 124h112" className="guide-svg-clear-line" />
      <Eye x="92" y="108" width="22" height="22" className="guide-svg-icon" />
      <text x="120" y="126" className="guide-svg-label">看清全图</text>
    </svg>
  );
}

const tutorialCards = [
  {
    title: "列车结构",
    text: "横向 3 格，纵向由车头、车厢和储物间组成。",
    icon: TrainFront,
    diagram: TrainOverviewDiagram,
  },
  {
    title: "八方向移动",
    text: "每个回合移动 1 格，斜向也消耗 1 格。",
    icon: Footprints,
    diagram: MoveDiagram,
  },
  {
    title: "挤压死亡",
    text: "移动到玩家所在格子时，对方死亡，你占据该格。",
    icon: Crosshair,
    diagram: SqueezeDiagram,
  },
  {
    title: "喝水倒计时",
    text: "跨过车厢之间的门会重置；连续 9 轮未喝水会死亡。",
    icon: Droplets,
    diagram: WaterDiagram,
  },
  {
    title: "雾视",
    text: "使用后短暂看清所有玩家位置，结果只对自己可见。",
    icon: Eye,
    diagram: FogVisionDiagram,
  },
];

const roleDetails: Partial<Record<RoleId, string[]>> = {
  unlucky: [
    "没有主动技能，只能进行基础移动。",
    "依靠判断、选位和喝水路线活到最后。",
  ],
  hunter: [
    "开局持有 1 颗子弹，进入储物间会自动补满。",
    "开一枪会沿上下左右穿透最多 4 格。",
    "子弹命中路径上所有玩家，随后触发后坐力移动。",
  ],
  conductor: [
    "固定从车头 2×3 区域中选择出生格。",
    "可以封锁附近连接处 3 个全局轮次。",
    "锁门只阻止跨区，不阻止站在连接处两侧的格子。",
  ],
  painter: [
    "拥有 3 桶白漆，可在自身 3×3 范围内倒漆。",
    "站在白漆上的玩家会在接下来两个回合扩散白漆。",
    "踩到自己上一回合制造的白漆不会刷新扩散次数。",
  ],
  traveler: [
    "喝水倒计时初始值和跨车厢门后的重置值均为 13。",
    "拥有一个背包，可以抵挡一次子弹、古籍等主动道具伤害。",
    "背包抵挡后永久消失，但不能抵挡挤压、Bug 或系统死亡。",
  ],
  sorcerer: [
    "无法进行普通雾视，其他玩家雾视时会进入响应阶段。",
    "预言球可多次发动，使自己获得本次匿名雾视位置。",
    "隐身衣整局一次，可让自己的位置从本次雾视结果中移除。",
  ],
  archaeologist: [
    "每名考古学家拥有独立古籍和 3 次阅读次数。",
    "阅读可以固定标记一名其他存活玩家的位置与角色。",
    "古籍可以投掷 3 格，遇到玩家或区域边界会停下。",
  ],
  thief: [
    "开局携带 1 个钩子，进入储物间时会自动补满。",
    "钩子可以传送到当前区域内的任意格子，并公开起点和终点。",
    "落点有人时按挤压结算，落点是 Bug 时改为小偷死亡。",
  ],
  corpse: [
    "除了开局选位外不能移动，也不能使用雾视。",
    "不会因口渴死亡，但仍可被子弹和普通挤压杀死。",
    "当其他玩家全部死亡后，尸体成为唯一存活者即获胜。",
  ],
  bug: [
    "移动和喝水规则与其他角色一致，可以使用雾视。",
    "Bug 主动踩到别人时 Bug 死亡；别人踩到 Bug 时对方死亡。",
    "Bug 接触造成的死亡不计入击杀次数。",
  ],
};

export function GameGuide({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GuideTab>("basics");
  const [selectedRole, setSelectedRole] = useState<RoleId>("hunter");
  const roles = Object.values(ROLE_REGISTRY).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const role = roles.find((candidate) => candidate.id === selectedRole) ?? ROLE_HUNTER;
  const skill = role.skillIds[0] ? SKILL_REGISTRY[role.skillIds[0]] : null;
  const details = roleDetails[role.id] ?? [
    role.description || "暂无",
    "技能与详细机制将在后续版本开放。",
  ];

  return (
    <>
      <button
        className={compact ? "secondary guide-trigger compact" : "secondary guide-trigger"}
        onClick={() => setOpen(true)}
        type="button"
      >
        <BookOpen size={18} />
        游戏介绍
      </button>

      {open && createPortal(
        <div className="guide-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-label="游戏介绍"
            aria-modal="true"
            className="guide-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="guide-header">
              <div>
                <p className="eyebrow">MistyTrain.com · 雾中列车</p>
                <h2>游戏介绍</h2>
              </div>
              <button className="icon-button" onClick={() => setOpen(false)} title="关闭" type="button">
                <X size={20} />
              </button>
            </header>

            <div className="segmented guide-tabs">
              <button className={tab === "basics" ? "active" : ""} onClick={() => setTab("basics")} type="button">
                基础教程
              </button>
              <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")} type="button">
                角色介绍
              </button>
            </div>

            {tab === "basics" ? (
              <div className="tutorial-grid">
                {tutorialCards.map((card) => {
                  const Icon = card.icon;
                  const Diagram = card.diagram;
                  return (
                    <article className="tutorial-card" key={card.title}>
                      <div className="tutorial-diagram"><Diagram /></div>
                      <div className="tutorial-copy">
                        <span><Icon size={18} />{card.title}</span>
                        <p>{card.text}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="role-guide-layout">
                <div className="role-guide-grid">
                  {roles.map((candidate) => (
                    <button
                      className={[
                        "role-guide-card",
                        candidate.id === selectedRole ? "selected" : "",
                        candidate.available ? "" : "locked",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={candidate.id}
                      onClick={() => setSelectedRole(candidate.id)}
                      type="button"
                    >
                      <RoleIcon
                        className={`role-symbol role-symbol-${candidate.id}`}
                        icon={candidate.icon}
                        symbol={candidate.symbol}
                      />
                      <strong>{candidate.name}</strong>
                      <small className="role-positioning">
                        {candidate.available ? "已开放" : "未开放"} · 定位：
                        {candidate.positioning || "暂无"}
                      </small>
                      <small>{candidate.description}</small>
                    </button>
                  ))}
                </div>
                <aside className="role-detail">
                  <div className="role-detail-title">
                    <RoleIcon
                      className={`role-symbol role-symbol-${role.id}`}
                      icon={role.icon}
                      symbol={role.symbol}
                    />
                    <div>
                      <p className="eyebrow">
                        {role.available ? "已开放角色" : "未开放角色"} · 定位：
                        {role.positioning || "暂无"}
                      </p>
                      <h3>{role.name}</h3>
                    </div>
                  </div>
                  {skill && (
                    <div className="role-skill-box">
                      {role.id === "hunter" ? (
                        <Crosshair size={18} />
                      ) : role.id === "conductor" ? (
                        <LockKeyhole size={18} />
                      ) : role.id === "thief" ? (
                        <Footprints size={18} />
                      ) : (
                        <PaintBucket size={18} />
                      )}
                      <div>
                        <strong>{skill.name}</strong>
                        <p>{skill.description}</p>
                      </div>
                    </div>
                  )}
                  <ul>
                    {details.map((detail) => <li key={detail}>{detail}</li>)}
                  </ul>
                </aside>
              </div>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
