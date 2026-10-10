import {
  DEFAULT_MAP_ID,
  type BoardMap,
  type BoardSection,
  type MapId,
  type Position,
  type SectionType,
} from "./types";

export const BOARD_COLUMNS = 3;

function createStandardTrain(playerCount: number): BoardMap {
  const sections: BoardSection[] = [];
  let nextY = 0;

  const addSection = (type: SectionType, index: number, height: number) => {
    const id = type === "engine" ? "engine" : type === "storage" ? "storage" : `carriage-${index}`;
    const label =
      type === "engine" ? "车头" : type === "storage" ? "储物间" : `车厢 ${index + 1}`;
    sections.push({
      id,
      type,
      index,
      label,
      startY: nextY,
      endY: nextY + height - 1,
    });
    nextY += height;
  };

  addSection("engine", 0, 2);
  for (let index = 0; index < playerCount; index += 1) {
    addSection("carriage", index, 4);
  }
  addSection("storage", 0, 2);

  return {
    columns: BOARD_COLUMNS,
    rows: nextY,
    sections,
  };
}

const MAP_BUILDERS: Partial<Record<MapId, (playerCount: number) => BoardMap>> = {
  // 新地图只需在这里注册构建器，并在地图注册表中标记 available。
  standard_train: createStandardTrain,
};

export function createBoard(
  playerCount: number,
  mapId: MapId = DEFAULT_MAP_ID,
): BoardMap {
  const builder = MAP_BUILDERS[mapId];
  if (!builder) throw new Error(`MAP_NOT_IMPLEMENTED:${mapId}`);
  return builder(playerCount);
}

export function getSectionAt(map: BoardMap, position: Position): BoardSection | undefined {
  return map.sections.find(
    (section) =>
      position.y >= section.startY &&
      position.y <= section.endY &&
      position.x >= 0 &&
      position.x < map.columns,
  );
}

export function isPositionOnMap(map: BoardMap, position: Position): boolean {
  return (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    position.x >= 0 &&
    position.x < map.columns &&
    position.y >= 0 &&
    position.y < map.rows
  );
}

export function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

export function isAdjacent(left: Position, right: Position): boolean {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) === 1;
}

export function isCarriageDoorCrossing(
  map: BoardMap,
  from: Position,
  to: Position,
): boolean {
  if (!isAdjacent(from, to)) return false;
  const fromSection = getSectionAt(map, from);
  const toSection = getSectionAt(map, to);
  if (!fromSection || !toSection || fromSection.id === toSection.id) return false;
  if (fromSection.type !== "carriage" || toSection.type !== "carriage") return false;
  return Math.abs(fromSection.index - toSection.index) === 1;
}

export function isDoorCrossing(map: BoardMap, from: Position, to: Position): boolean {
  const fromSection = getSectionAt(map, from);
  const toSection = getSectionAt(map, to);
  return Boolean(fromSection && toSection && fromSection.id !== toSection.id && isAdjacent(from, to));
}

export function getCarriageSections(map: BoardMap): BoardSection[] {
  return map.sections.filter((section) => section.type === "carriage");
}

export function getVisibleSectionIds(
  map: BoardMap,
  position: Position,
  radius = 1,
): string[] {
  const currentIndex = map.sections.findIndex(
    (section) =>
      position.y >= section.startY &&
      position.y <= section.endY &&
      position.x >= 0 &&
      position.x < map.columns,
  );
  if (currentIndex < 0) return map.sections.map((section) => section.id);
  const start = Math.max(0, currentIndex - radius);
  const end = Math.min(map.sections.length - 1, currentIndex + radius);
  return map.sections.slice(start, end + 1).map((section) => section.id);
}

export function positionsInSection(section: BoardSection, columns = BOARD_COLUMNS): Position[] {
  const positions: Position[] = [];
  for (let y = section.startY; y <= section.endY; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      positions.push({ x, y });
    }
  }
  return positions;
}
