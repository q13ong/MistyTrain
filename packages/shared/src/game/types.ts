/**
 * 前后端共享的领域协议。
 *
 * 这里只放稳定、可序列化的数据形状和常量，不放服务器规则实现。
 * 前端、Socket 事件和数据库恢复逻辑都依赖这些类型，新增角色或技能时
 * 应优先在这里定义公共契约，再分别实现服务端结算与前端展示。
 */
export type RoomPhase =
  | "lobby"
  | "role_select"
  | "placement"
  | "playing"
  | "finished"
  | "closed";

export type MemberKind = "player" | "spectator";
export type ControlState = "active" | "disconnected" | "dead" | "left";
export type DeathReason =
  | "squeeze"
  | "gunshot"
  | "book_impact"
  | "bug_contact"
  | "thirst"
  | "disconnect_timeout"
  | "voluntary_exit";
export type Direction =
  | "up"
  | "up_right"
  | "right"
  | "down_right"
  | "down"
  | "down_left"
  | "left"
  | "up_left";
export type SectionType = "engine" | "carriage" | "storage";
export type ActionType =
  | "move"
  | "skip"
  | "auto_place"
  | "skill"
  | "item"
  | "fog_vision";
export type RoleId =
  | "unlucky"
  | "hunter"
  | "conductor"
  | "painter"
  | "thief"
  | "traveler"
  | "blind_monk"
  | "sorcerer"
  | "archaeologist"
  | "assassin"
  | "smoker"
  | "nurse"
  | "bug"
  | "corpse"
  | "liangzi"
  | "director_xie"
  | "head_chef"
  | "ghost"
  | "merchant";
export type SkillId =
  | "hunter_shoot"
  | "conductor_lock"
  | "painter_paint"
  | "thief_hook";
export type MapId = "standard_train" | "luxury_train" | "fog_village";
export type RoleGroupId = "basic" | "fr" | "luxury_train" | "fog_village";
export type ItemId = "backpack" | "prophecy_ball" | "invisibility_cloak" | "ancient_book";
export type DamageKind = "item" | "contact" | "thirst" | "disconnect" | "voluntary";
export type BotDifficulty = "pure_bot" | "standard";
export const BOT_DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  pure_bot: "纯入机",
  standard: "标准",
};

export interface Position {
  x: number;
  y: number;
}

export interface BoardSection {
  id: string;
  type: SectionType;
  index: number;
  label: string;
  startY: number;
  endY: number;
}

export interface BoardMap {
  columns: 3;
  rows: number;
  sections: BoardSection[];
}

export interface RoleDefinition {
  id: RoleId;
  name: string;
  symbol: string;
  icon: string;
  positioning: string;
  description: string;
  available: boolean;
  group: RoleGroupId;
  requiredMapId: MapId | null;
  sortOrder: number;
  skillIds: SkillId[];
}

export interface GameMapDefinition {
  id: MapId;
  name: string;
  description: string;
  icon: string;
  available: boolean;
  sortOrder: number;
}

export interface SkillTargeting {
  kind: "none" | "cell" | "player" | "section" | "direction";
  min: number;
  max: number;
}

export interface SkillDefinition {
  id: SkillId;
  roleId: RoleId;
  name: string;
  description: string;
  targeting: SkillTargeting;
  cooldownRounds: number;
  effectIds: string[];
}

export interface DoorLockState {
  // 连接处唯一标识由上下两个区域组成，例如 "engine:carriage-0"。
  // 锁门只影响跨连接处移动，不影响玩家站在连接处两侧的格子上。
  connectionId: string;
  ownerParticipantId: string;
  upperSectionId: string;
  lowerSectionId: string;
  remainingConductorTurns: number;
}

export interface HookSignal {
  id: string;
  participantId: string;
  color: string;
  from: Position;
  to: Position;
  round: number;
  createdAt: string;
}

export type SkillUseTarget =
  | { kind: "direction"; direction: Direction }
  | { kind: "cell"; position: Position }
  | { kind: "connection"; connectionId: string }
  | { kind: "none" };

export type DeathPublicReason =
  | "挤压"
  | "中弹"
  | "古籍"
  | "Bug反噬"
  | "喝水超时"
  | "断线超时"
  | "主动退出";

export interface PlayerResult {
  participantId: string;
  userId: string;
  nickname: string;
  color: string;
  roleId: string;
  finalRank: number;
  survivedRounds: number;
  moveCount: number;
  skillUseCount: number;
  killCount: number;
  waterCount: number;
  deathRound: number | null;
  deathReason: DeathReason | null;
  isBot: boolean;
  initialPosition: Position | null;
  finalPosition: Position | null;
}

export interface ActionLog {
  id: string;
  seq: number;
  round: number | null;
  participantId: string;
  actionType: ActionType;
  fromPosition: Position | null;
  toPosition: Position | null;
  direction: Direction | null;
  crossedDoor: boolean;
  drank: boolean;
  skillId: string | null;
  skillTarget: unknown;
  killedParticipantIds: string[];
  died: boolean;
  createdAt: string;
}

export interface ReplayEvent {
  id: string;
  seq: number;
  round: number | null;
  type: string;
  actorParticipantId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ReplayPayload {
  roomCode: string;
  mapId: MapId;
  mapName: string;
  map: BoardMap;
  leaderboard: PlayerResult[];
  actions: ActionLog[];
  events: ReplayEvent[];
}

export interface BookMarkerView {
  id: string;
  bookId: string;
  position: Position;
  title: string;
}

export interface ReadingMarkView {
  targetParticipantId: string;
  nickname: string;
  roleId: string;
  position: Position;
}

export const ROLE_UNLUCKY: RoleDefinition = {
  id: "unlucky",
  name: "倒霉蛋",
  symbol: "霉",
  icon: "circle_help",
  positioning: "基础生存",
  description: "没有技能，只能进行基础移动。",
  available: true,
  group: "basic",
  requiredMapId: null,
  sortOrder: 10,
  skillIds: [],
};

export const ROLE_HUNTER: RoleDefinition = {
  id: "hunter",
  name: "猎人",
  symbol: "猎",
  icon: "crosshair",
  positioning: "远程爆发",
  description: "持有猎枪和 1 颗子弹，开枪后会被后坐力推动。",
  available: true,
  group: "basic",
  requiredMapId: null,
  sortOrder: 20,
  skillIds: ["hunter_shoot"],
};

export const ROLE_CONDUCTOR: RoleDefinition = {
  id: "conductor",
  name: "列车长",
  symbol: "列",
  icon: "train",
  positioning: "区域控制",
  description: "从车头出生，可以封锁区域连接处，阻止玩家跨区移动。",
  available: true,
  group: "basic",
  requiredMapId: null,
  sortOrder: 30,
  skillIds: ["conductor_lock"],
};

export const ROLE_PAINTER: RoleDefinition = {
  id: "painter",
  name: "粉刷匠",
  symbol: "刷",
  icon: "paint_bucket",
  positioning: "地形控制",
  description: "携带 3 桶白漆，沾漆玩家移动时会继续扩散白漆。",
  available: true,
  group: "basic",
  requiredMapId: null,
  sortOrder: 40,
  skillIds: ["painter_paint"],
};

export const ROLE_THIEF: RoleDefinition = {
  id: "thief",
  name: "小偷",
  symbol: "偷",
  icon: "footprints",
  positioning: "潜行与资源",
  description: "携带一个钩子，可以在当前区域内快速传送并留下公开轨迹。",
  available: true,
  group: "basic",
  requiredMapId: null,
  sortOrder: 50,
  skillIds: ["thief_hook"],
};

export const ROLE_BUG: RoleDefinition = {
  id: "bug",
  name: "Bug",
  symbol: "BUG",
  icon: "bug",
  positioning: "规则干扰",
  description: "会正常移动，但任何主动或被动的接触都可能触发反噬死亡。",
  available: true,
  group: "fr",
  requiredMapId: null,
  sortOrder: 120,
  skillIds: [],
};

export const ROLE_CORPSE: RoleDefinition = {
  id: "corpse",
  name: "尸体",
  symbol: "尸",
  icon: "skull",
  positioning: "特殊状态",
  description: "除开局选位外不能移动，也无法使用雾视，但不会因口渴死亡。",
  available: true,
  group: "fr",
  requiredMapId: null,
  sortOrder: 130,
  skillIds: [],
};

const lockedRoles: RoleDefinition[] = [
  {
    id: "traveler",
    name: "旅者",
    symbol: "旅",
    icon: "compass",
    positioning: "机动",
    description: "喝水倒计时为 13 回合，并携带可抵挡一次主动道具伤害的背包。",
    available: true,
    group: "basic",
    requiredMapId: null,
    sortOrder: 60,
    skillIds: [],
  },
  {
    id: "blind_monk",
    name: "盲僧",
    symbol: "盲",
    icon: "eye_off",
    positioning: "感知",
    description: "不依赖视线判断位置，具体能力尚未开放。",
    available: false,
    group: "basic",
    requiredMapId: null,
    sortOrder: 70,
    skillIds: [],
  },
  {
    id: "sorcerer",
    name: "咒术师",
    symbol: "咒",
    icon: "sparkles",
    positioning: "法术",
    description: "无法雾视，但可以通过预言球或隐身衣响应他人的雾视。",
    available: true,
    group: "basic",
    requiredMapId: null,
    sortOrder: 80,
    skillIds: [],
  },
  {
    id: "archaeologist",
    name: "考古学者",
    symbol: "古",
    icon: "search",
    positioning: "探索",
    description: "携带可投掷的古籍，并能消耗阅读次数定位其他玩家。",
    available: true,
    group: "basic",
    requiredMapId: null,
    sortOrder: 90,
    skillIds: [],
  },
  {
    id: "assassin",
    name: "刺客",
    symbol: "刺",
    icon: "swords",
    positioning: "爆发",
    description: "围绕单次击杀与接近目标展开的进阶角色。",
    available: false,
    group: "basic",
    requiredMapId: null,
    sortOrder: 100,
    skillIds: [],
  },
  {
    id: "smoker",
    name: "烟瘾少年",
    symbol: "烟",
    icon: "cigarette",
    positioning: "持续状态",
    description: "通过烟雾和持续状态影响周围玩家的判断。",
    available: false,
    group: "fog_village",
    requiredMapId: "fog_village",
    sortOrder: 190,
    skillIds: [],
  },
  {
    id: "nurse",
    name: "护士",
    symbol: "护",
    icon: "cross",
    positioning: "救援",
    description: "可能围绕治疗、保护与死亡判定建立能力。",
    available: false,
    group: "fog_village",
    requiredMapId: "fog_village",
    sortOrder: 180,
    skillIds: [],
  },
  {
    id: "liangzi",
    name: "良子",
    symbol: "良",
    icon: "user_round",
    positioning: "暂无",
    description: "暂无",
    available: false,
    group: "luxury_train",
    requiredMapId: "luxury_train",
    sortOrder: 150,
    skillIds: [],
  },
  {
    id: "director_xie",
    name: "谢导",
    symbol: "导",
    icon: "clapperboard",
    positioning: "场景调度",
    description: "可能通过改变事件顺序或镜头规则影响对局。",
    available: false,
    group: "luxury_train",
    requiredMapId: "luxury_train",
    sortOrder: 140,
    skillIds: [],
  },
  {
    id: "head_chef",
    name: "厨师长",
    symbol: "厨",
    icon: "cooking_pot",
    positioning: "资源",
    description: "围绕补给和物资分配设计，目前尚未开放。",
    available: false,
    group: "luxury_train",
    requiredMapId: "luxury_train",
    sortOrder: 160,
    skillIds: [],
  },
  {
    id: "ghost",
    name: "幽魂",
    symbol: "魂",
    icon: "ghost",
    positioning: "灵体",
    description: "可能以幽灵状态继续影响对局，目前尚未开放。",
    available: false,
    group: "basic",
    requiredMapId: null,
    sortOrder: 110,
    skillIds: [],
  },
  {
    id: "merchant",
    name: "商人",
    symbol: "商",
    icon: "briefcase",
    positioning: "交易",
    description: "技能尚未开放。",
    available: false,
    group: "luxury_train",
    requiredMapId: "luxury_train",
    sortOrder: 170,
    skillIds: [],
  },
];

export const ROLE_REGISTRY: Record<RoleId, RoleDefinition> = {
  unlucky: ROLE_UNLUCKY,
  hunter: ROLE_HUNTER,
  conductor: ROLE_CONDUCTOR,
  painter: ROLE_PAINTER,
  thief: ROLE_THIEF,
  traveler: lockedRoles.find((role) => role.id === "traveler")!,
  blind_monk: lockedRoles.find((role) => role.id === "blind_monk")!,
  sorcerer: lockedRoles.find((role) => role.id === "sorcerer")!,
  archaeologist: lockedRoles.find((role) => role.id === "archaeologist")!,
  assassin: lockedRoles.find((role) => role.id === "assassin")!,
  smoker: lockedRoles.find((role) => role.id === "smoker")!,
  nurse: lockedRoles.find((role) => role.id === "nurse")!,
  bug: ROLE_BUG,
  corpse: ROLE_CORPSE,
  liangzi: lockedRoles.find((role) => role.id === "liangzi")!,
  director_xie: lockedRoles.find((role) => role.id === "director_xie")!,
  head_chef: lockedRoles.find((role) => role.id === "head_chef")!,
  ghost: lockedRoles.find((role) => role.id === "ghost")!,
  merchant: lockedRoles.find((role) => role.id === "merchant")!,
};

export const ROLE_GROUP_ORDER: RoleGroupId[] = [
  "basic",
  "fr",
  "luxury_train",
  "fog_village",
];

export const ROLE_GROUP_LABELS: Record<RoleGroupId, string> = {
  basic: "基础组",
  fr: "F·R特供组",
  luxury_train: "豪华列车限定组",
  fog_village: "雾之村限定组",
};

export const MAP_STANDARD_TRAIN: GameMapDefinition = {
  id: "standard_train",
  name: "普通列车",
  description: "当前可用的标准 3 列列车地图。",
  icon: "train",
  available: true,
  sortOrder: 10,
};

export const MAP_LUXURY_TRAIN: GameMapDefinition = {
  id: "luxury_train",
  name: "豪华列车",
  description: "更多车厢与特殊设施的列车地图，尚未开放。",
  icon: "sparkles",
  available: false,
  sortOrder: 20,
};

export const MAP_FOG_VILLAGE: GameMapDefinition = {
  id: "fog_village",
  name: "雾之村",
  description: "离开列车后的村落地图，尚未开放。",
  icon: "cloud_fog",
  available: false,
  sortOrder: 30,
};

export const DEFAULT_MAP_ID: MapId = "standard_train";

export const MAP_REGISTRY: Record<MapId, GameMapDefinition> = {
  standard_train: MAP_STANDARD_TRAIN,
  luxury_train: MAP_LUXURY_TRAIN,
  fog_village: MAP_FOG_VILLAGE,
};

export const SKILL_REGISTRY: Record<SkillId, SkillDefinition> = {
  hunter_shoot: {
    id: "hunter_shoot",
    roleId: "hunter",
    name: "开一枪",
    description: "向上下左右方向射击 4 格，随后向后坐力方向自动移动 1 格。",
    targeting: { kind: "direction", min: 1, max: 1 },
    cooldownRounds: 0,
    effectIds: ["bullet_path", "recoil"],
  },
  conductor_lock: {
    id: "conductor_lock",
    roleId: "conductor",
    name: "锁门",
    description: "封锁身边最近的区域连接处 3 个全局轮次。",
    targeting: { kind: "section", min: 1, max: 1 },
    cooldownRounds: 0,
    effectIds: ["door_lock"],
  },
  painter_paint: {
    id: "painter_paint",
    roleId: "painter",
    name: "倒漆",
    description: "在自身周围 3×3 范围内倒下一格白漆。",
    targeting: { kind: "cell", min: 1, max: 1 },
    cooldownRounds: 0,
    effectIds: ["white_paint"],
  },
  thief_hook: {
    id: "thief_hook",
    roleId: "thief",
    name: "钩子",
    description: "传送到当前区域内的任意格子，并公开钩子的起点和终点。",
    targeting: { kind: "cell", min: 1, max: 1 },
    cooldownRounds: 0,
    effectIds: ["hook_teleport"],
  },
};

export const PHRASES = [
  { id: "ready", text: "准备好了" },
  { id: "hurry", text: "快一点" },
  { id: "dont_come", text: "别过来" },
  { id: "help", text: "救命" },
  { id: "nice", text: "厉害" },
  { id: "gg", text: "GG" },
] as const;

export const DEATH_REASON_TEXT: Record<DeathReason, DeathPublicReason> = {
  squeeze: "挤压",
  gunshot: "中弹",
  book_impact: "古籍",
  bug_contact: "Bug反噬",
  thirst: "喝水超时",
  disconnect_timeout: "断线超时",
  voluntary_exit: "主动退出",
};
