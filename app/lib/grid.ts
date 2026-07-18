import type {
  Coord,
  GrowthCandidate,
  ItemDefinition,
  PatternRequirement,
  PlacedItem,
  Rotation,
  Stats,
  StructureDefinition,
  StructureMatch,
} from "../types";

const ORTHOGONAL_DIRECTIONS: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function coordKey(coord: Coord): string {
  return `${coord.x},${coord.y}`;
}

export function getItemDimensions(
  item: Pick<ItemDefinition, "width" | "height">,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: item.height, height: item.width }
    : { width: item.width, height: item.height };
}

export function getItemCenter(
  placement: Pick<PlacedItem, "x" | "y" | "rotation">,
  item: Pick<ItemDefinition, "width" | "height">,
): Coord {
  const dimensions = getItemDimensions(item, placement.rotation);
  return {
    x: placement.x + (dimensions.width - 1) / 2,
    y: placement.y + (dimensions.height - 1) / 2,
  };
}

export function getItemAnchorAtPoint(
  point: Coord,
  item: Pick<ItemDefinition, "width" | "height">,
  rotation: Rotation,
): Coord {
  const dimensions = getItemDimensions(item, rotation);
  return {
    x: Math.round(point.x - (dimensions.width - 1) / 2),
    y: Math.round(point.y - (dimensions.height - 1) / 2),
  };
}

export function getItemFootprint(
  placement: Pick<PlacedItem, "x" | "y" | "rotation">,
  item: Pick<ItemDefinition, "width" | "height">,
): Coord[] {
  const dimensions = getItemDimensions(item, placement.rotation);
  const result: Coord[] = [];
  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      result.push({ x: placement.x + x, y: placement.y + y });
    }
  }
  return result;
}

export function buildOccupancyMap(
  placements: PlacedItem[],
  items: ItemDefinition[],
  excludedInstanceId?: string,
): Map<string, PlacedItem> {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const occupied = new Map<string, PlacedItem>();
  for (const placement of placements) {
    if (placement.instanceId === excludedInstanceId) continue;
    const item = itemMap.get(placement.itemId);
    if (!item) continue;
    for (const cell of getItemFootprint(placement, item)) {
      occupied.set(coordKey(cell), placement);
    }
  }
  return occupied;
}

export function canPlaceItem(
  placement: PlacedItem,
  cells: Coord[],
  placements: PlacedItem[],
  items: ItemDefinition[],
  excludedInstanceId?: string,
): boolean {
  const item = items.find((candidate) => candidate.id === placement.itemId);
  if (!item) return false;
  const cellKeys = new Set(cells.map(coordKey));
  const occupied = buildOccupancyMap(
    placements,
    items,
    excludedInstanceId,
  );
  return getItemFootprint(placement, item).every(
    (coord) => cellKeys.has(coordKey(coord)) && !occupied.has(coordKey(coord)),
  );
}

export function getGrowthCandidates(
  cells: Coord[],
  placements: PlacedItem[],
  items: ItemDefinition[],
): GrowthCandidate[] {
  const cellKeys = new Set(cells.map(coordKey));
  const candidates = new Map<string, Coord>();

  for (const cell of cells) {
    for (const direction of ORTHOGONAL_DIRECTIONS) {
      const candidate = {
        x: cell.x + direction.x,
        y: cell.y + direction.y,
      };
      const key = coordKey(candidate);
      if (!cellKeys.has(key)) candidates.set(key, candidate);
    }
  }

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const influencedCells: Array<{
    itemName: string;
    influence: number;
    cell: Coord;
  }> = [];

  for (const placement of placements) {
    const item = itemMap.get(placement.itemId);
    if (!item || item.growthInfluence <= 0) continue;
    for (const cell of getItemFootprint(placement, item)) {
      influencedCells.push({
        itemName: item.name,
        influence: item.growthInfluence,
        cell,
      });
    }
  }

  const weighted = [...candidates.values()].map((candidate) => {
    let strongestInfluence = 0;
    let influencedBy: string | undefined;
    for (const source of influencedCells) {
      const distance =
        Math.abs(source.cell.x - candidate.x) +
        Math.abs(source.cell.y - candidate.y);
      if (distance === 1 && source.influence > strongestInfluence) {
        strongestInfluence = source.influence;
        influencedBy = source.itemName;
      }
    }
    return {
      ...candidate,
      weight: 1 + strongestInfluence,
      probability: 0,
      influencedBy,
    };
  });

  const totalWeight = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  return weighted
    .map((candidate) => ({
      ...candidate,
      probability: totalWeight === 0 ? 0 : candidate.weight / totalWeight,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function isConnected(cells: Coord[]): boolean {
  if (cells.length === 0) return false;
  const remaining = new Set(cells.map(coordKey));
  const queue: Coord[] = [cells[0]];
  remaining.delete(coordKey(cells[0]));

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const direction of ORTHOGONAL_DIRECTIONS) {
      const neighbor = {
        x: current.x + direction.x,
        y: current.y + direction.y,
      };
      const key = coordKey(neighbor);
      if (!remaining.has(key)) continue;
      remaining.delete(key);
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}

function rotateCoord(coord: Coord, rotation: Rotation): Coord {
  if (rotation === 90) return { x: -coord.y, y: coord.x };
  if (rotation === 180) return { x: -coord.x, y: -coord.y };
  if (rotation === 270) return { x: coord.y, y: -coord.x };
  return coord;
}

function transformRequirements(
  requirements: PatternRequirement[],
  rotation: Rotation,
  reflected: boolean,
): PatternRequirement[] {
  return requirements.map((requirement) => {
    const reflectedCoord = reflected
      ? { x: -requirement.x, y: requirement.y }
      : requirement;
    const transformed = rotateCoord(reflectedCoord, rotation);
    return { ...requirement, ...transformed };
  });
}

function itemMatchesRequirement(
  item: ItemDefinition,
  requirement: PatternRequirement,
): boolean {
  const hasRestrictions =
    Boolean(requirement.itemIds?.length) || Boolean(requirement.tagsAny?.length);
  if (!hasRestrictions) return true;
  const idMatches = requirement.itemIds?.includes(item.id) ?? false;
  const tagMatches =
    requirement.tagsAny?.some((tag) => item.tags.includes(tag)) ?? false;
  return idMatches || tagMatches;
}

export function detectStructures(
  definitions: StructureDefinition[],
  placements: PlacedItem[],
  items: ItemDefinition[],
): StructureMatch[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const placementAt = new Map(
    placements.map((placement) => [coordKey(placement), placement]),
  );
  const matches: StructureMatch[] = [];

  for (const structure of definitions) {
    const rotations: Rotation[] = structure.allowRotations
      ? [0, 90, 180, 270]
      : [0];
    const reflections = structure.allowReflections ? [false, true] : [false];
    let found: StructureMatch | undefined;

    for (const reflected of reflections) {
      for (const rotation of rotations) {
        const requirements = transformRequirements(
          structure.requirements,
          rotation,
          reflected,
        );
        const firstRequirement = requirements[0];

        for (const firstPlacement of placements) {
          const firstItem = itemMap.get(firstPlacement.itemId);
          if (!firstItem || !itemMatchesRequirement(firstItem, firstRequirement)) {
            continue;
          }
          const offset = {
            x: firstPlacement.x - firstRequirement.x,
            y: firstPlacement.y - firstRequirement.y,
          };
          const instanceIds: string[] = [];
          let valid = true;

          for (const requirement of requirements) {
            const placement = placementAt.get(
              coordKey({
                x: requirement.x + offset.x,
                y: requirement.y + offset.y,
              }),
            );
            const item = placement ? itemMap.get(placement.itemId) : undefined;
            if (!placement || !item || !itemMatchesRequirement(item, requirement)) {
              valid = false;
              break;
            }
            instanceIds.push(placement.instanceId);
          }

          if (valid && new Set(instanceIds).size === requirements.length) {
            found = { structure, instanceIds, rotation, reflected };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (found) matches.push(found);
  }
  return matches;
}

export function calculateStats(
  baseStats: Stats,
  placements: PlacedItem[],
  items: ItemDefinition[],
  structures: StructureMatch[],
): Stats {
  const result = { ...baseStats };
  const itemMap = new Map(items.map((item) => [item.id, item]));
  for (const placement of placements) {
    const item = itemMap.get(placement.itemId);
    if (!item) continue;
    for (const key of Object.keys(result) as Array<keyof Stats>) {
      result[key] += item.modifiers[key] ?? 0;
    }
  }
  for (const match of structures) {
    for (const key of Object.keys(result) as Array<keyof Stats>) {
      result[key] += match.structure.modifiers[key] ?? 0;
    }
  }
  return result;
}

export function seededRandom(seed: string, step: number): number {
  let hash = 2166136261;
  const value = `${seed}:${step}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  state += 0x6d2b79f5;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

export function chooseGrowthCandidate(
  candidates: GrowthCandidate[],
  randomValue: number,
): GrowthCandidate | undefined {
  if (candidates.length === 0) return undefined;
  let cursor = randomValue;
  for (const candidate of candidates) {
    cursor -= candidate.probability;
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}
