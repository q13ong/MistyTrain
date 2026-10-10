import { randomInt } from "node:crypto";

// 2015 年及以后番剧中的女性角色名；“管绩答”是唯一保留的特例。
export const BOT_NAME_POOL = [
  "赫斯提亚",
  "艾丝·华伦斯坦",
  "蕾姆",
  "拉姆",
  "艾米莉娅",
  "惠惠",
  "阿库娅",
  "达克妮斯",
  "加藤惠",
  "泽村英梨梨",
  "霞之丘诗羽",
  "雪之下雪乃",
  "由比滨结衣",
  "一色彩羽",
  "土间埋",
  "康娜",
  "托尔",
  "02",
  "莓",
  "血小板",
  "祢豆子",
  "蝴蝶忍",
  "甘露寺蜜璃",
  "栗花落香奈乎",
  "中野一花",
  "中野二乃",
  "中野三玖",
  "中野四叶",
  "中野五月",
  "后藤一里",
] as const;

export const GOLDEN_BOT_NAME = "管绩答";

export function chooseBotName(usedNames: Set<string>): string {
  const candidates = [...BOT_NAME_POOL, GOLDEN_BOT_NAME].filter(
    (name) => !usedNames.has(name),
  );
  if (candidates.length === 0) throw new Error("BOT_NAMES_EXHAUSTED");
  return candidates[randomInt(0, candidates.length)]!;
}
