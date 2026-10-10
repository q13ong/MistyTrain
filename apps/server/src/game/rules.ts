import {
  createBoard,
  DEFAULT_MAP_ID,
  getSectionAt,
  isAdjacent,
  isCarriageDoorCrossing,
  isPositionOnMap,
  positionsInSection,
  type BoardMap,
  type Direction,
  type MapId,
  type Position,
} from "@fog-train/shared";

export const DIRECTION_VECTORS: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  up_right: { x: 1, y: -1 },
  right: { x: 1, y: 0 },
  down_right: { x: 1, y: 1 },
  down: { x: 0, y: 1 },
  down_left: { x: -1, y: 1 },
  left: { x: -1, y: 0 },
  up_left: { x: -1, y: -1 },
};

export function destination(position: Position, direction: Direction): Position {
  const vector = DIRECTION_VECTORS[direction];
  return { x: position.x + vector.x, y: position.y + vector.y };
}

export function legalDirections(map: BoardMap, position: Position): Direction[] {
  return (Object.keys(DIRECTION_VECTORS) as Direction[]).filter((direction) =>
    isPositionOnMap(map, destination(position, direction)),
  );
}

export function validateMove(map: BoardMap, from: Position, to: Position): boolean {
  return isPositionOnMap(map, to) && isAdjacent(from, to);
}

export function crossesCarriageDoor(map: BoardMap, from: Position, to: Position): boolean {
  return isCarriageDoorCrossing(map, from, to);
}

export function sectionPositions(map: BoardMap, sectionId: string): Position[] {
  const section = map.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return [];
  return positionsInSection(section, map.columns);
}

export function isPositionInSection(map: BoardMap, position: Position, sectionId: string): boolean {
  const section = map.sections.find((candidate) => candidate.id === sectionId);
  if (!section || getSectionAt(map, position)?.id !== section.id) return false;
  return position.x >= 0 && position.x < map.columns;
}

export function boardForPlayers(
  playerCount: number,
  mapId: MapId = DEFAULT_MAP_ID,
): BoardMap {
  return createBoard(playerCount, mapId);
}
