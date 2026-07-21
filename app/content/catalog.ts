import type {
  ItemDefinition,
  PlacedItem,
  StructureDefinition,
  WorkspaceData,
} from "../types";

const LEGACY_GROWTH_DIRECTIONS = [
  { name: "north", x: 0, y: -1 },
  { name: "east", x: 1, y: 0 },
  { name: "south", x: 0, y: 1 },
  { name: "west", x: -1, y: 0 },
] as const;

const GROWTH_PATH_ITEM_IDS = new Set(["growth-branch", "growth-tip"]);

function placementKey(placement: Pick<PlacedItem, "x" | "y">): string {
  return `${placement.x},${placement.y}`;
}

export function migrateGrowthLineage(placements: PlacedItem[]): PlacedItem[] {
  const migrated = placements.map((placement) => ({ ...placement }));
  const byCoord = new Map(
    migrated.map((placement) => [placementKey(placement), placement]),
  );
  const assigned = new Set(
    migrated
      .filter((placement) => placement.growthStreamId)
      .map((placement) => placement.instanceId),
  );
  const legacyStreamIds = new Set<string>();
  const depths = new Map<string, number>();

  for (const node of migrated.filter(
    (placement) => placement.itemId === "growth-node",
  )) {
    const queue: Array<{ placement: PlacedItem; depth: number }> = [];

    for (const direction of LEGACY_GROWTH_DIRECTIONS) {
      const seed = byCoord.get(
        `${node.x + direction.x},${node.y + direction.y}`,
      );
      if (
        !seed ||
        assigned.has(seed.instanceId) ||
        !GROWTH_PATH_ITEM_IDS.has(seed.itemId)
      ) {
        continue;
      }

      const streamId = `legacy-${node.instanceId}-${direction.name}`;
      seed.growthStreamId = streamId;
      seed.growthParentInstanceId = node.instanceId;
      seed.growthOriginNodeInstanceId = node.instanceId;
      assigned.add(seed.instanceId);
      legacyStreamIds.add(streamId);
      depths.set(seed.instanceId, 1);
      queue.push({ placement: seed, depth: 1 });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const direction of LEGACY_GROWTH_DIRECTIONS) {
        const next = byCoord.get(
          `${current.placement.x + direction.x},${current.placement.y + direction.y}`,
        );
        if (
          !next ||
          assigned.has(next.instanceId) ||
          !GROWTH_PATH_ITEM_IDS.has(next.itemId)
        ) {
          continue;
        }
        next.growthStreamId = current.placement.growthStreamId;
        next.growthParentInstanceId = current.placement.instanceId;
        next.growthOriginNodeInstanceId = node.instanceId;
        assigned.add(next.instanceId);
        depths.set(next.instanceId, current.depth + 1);
        queue.push({ placement: next, depth: current.depth + 1 });
      }
    }
  }

  for (const streamId of legacyStreamIds) {
    const streamItems = migrated.filter(
      (placement) => placement.growthStreamId === streamId,
    );
    const ranked = streamItems.sort(
      (a, b) =>
        (depths.get(b.instanceId) ?? 0) -
          (depths.get(a.instanceId) ?? 0) ||
        a.instanceId.localeCompare(b.instanceId),
    );
    const endpoint = ranked.find(
      (placement) => placement.itemId === "growth-tip",
    ) ?? ranked[0];
    for (const placement of streamItems) {
      if (placement.itemId === "growth-tip") {
        placement.itemId = "growth-branch";
      }
    }
    if (endpoint) endpoint.itemId = "growth-tip";
  }

  return migrated;
}

export const BUILT_IN_ITEMS: ItemDefinition[] = [
  {
    id: "iron-shard",
    name: "nuikgi",
    description: "A compact test component that adds direct weapon power.",
    width: 1,
    height: 1,
    color: "#c97b5c",
    symbol: "I",
    tags: ["conduit", "metal"],
    modifiers: { power: 2 },
    growthInfluence: 0,
    builtIn: true,
  },
  {
    id: "growth-node",
    name: "Growth Node",
    description:
      "Raises nearby grid-growth weight by 10% and can start up to four independent branch streams, one from each side of the node.",
    width: 1,
    height: 1,
    color: "#64a774",
    symbol: "G",
    tags: ["growth", "living"],
    modifiers: { stability: 1 },
    growthInfluence: 0.1,
    builtIn: true,
  },
  {
    id: "growth-branch",
    name: "Growth Branch",
    description:
      "An internal segment of a living branch. It remains a separate item, but only the Growth Tip at the end can extend the branch.",
    width: 1,
    height: 1,
    color: "#83b66f",
    symbol: "B",
    tags: ["growth", "living", "branch"],
    modifiers: {},
    growthInfluence: 0,
    builtIn: true,
  },
  {
    id: "growth-tip",
    name: "Growth Tip",
    description:
      "The active end of a living branch. When it extends, this item becomes a Growth Branch and a new Tip appears ahead; a capped Tip has no open populated slot.",
    width: 1,
    height: 1,
    color: "#b8d878",
    symbol: "T",
    tags: ["growth", "living", "tip"],
    modifiers: {},
    growthInfluence: 0,
    builtIn: true,
  },
  {
    id: "focus-lens",
    name: "Focus Lens",
    description: "A precise one-cell component used to test tagged structures.",
    width: 1,
    height: 1,
    color: "#4da6a8",
    symbol: "F",
    tags: ["conduit", "focus"],
    modifiers: { critical: 3 },
    growthInfluence: 0,
    builtIn: true,
  },
  {
    id: "stabilizer-bar",
    name: "Stabilizer Bar",
    description: "A rotatable two-cell component that reinforces stability.",
    width: 1,
    height: 2,
    color: "#7187b8",
    symbol: "S",
    tags: ["stabilizer", "conduit"],
    modifiers: { stability: 4, speed: -1 },
    growthInfluence: 0,
    builtIn: true,
  },
  {
    id: "core-plate",
    name: "Core Plate",
    description: "A heavy 2×2 test item for validating large-item placement.",
    width: 2,
    height: 2,
    color: "#9b6eb0",
    symbol: "C",
    tags: ["core", "heavy"],
    modifiers: { power: 6, speed: -2, stability: 3 },
    growthInfluence: 0,
    builtIn: true,
  },
];

export const STRUCTURES: StructureDefinition[] = [
  {
    id: "resonant-pair",
    name: "Test Pattern: Resonant Pair",
    description:
      "Place a nuikgi edge-adjacent to a Growth Node in either orientation.",
    requirements: [
      { x: 0, y: 0, itemIds: ["iron-shard"] },
      { x: 1, y: 0, itemIds: ["growth-node"] },
    ],
    allowRotations: true,
    allowReflections: false,
    modifiers: { power: 4, stability: 2 },
    ability: "Resonance online",
    testOnly: true,
  },
  {
    id: "conduit-line",
    name: "Test Pattern: Conduit Line",
    description:
      "Place three items tagged ‘conduit’ in a straight three-cell line.",
    requirements: [
      { x: 0, y: 0, tagsAny: ["conduit"] },
      { x: 1, y: 0, tagsAny: ["conduit"] },
      { x: 2, y: 0, tagsAny: ["conduit"] },
    ],
    allowRotations: true,
    allowReflections: false,
    modifiers: { power: 3, critical: 2 },
    ability: "Conduit alignment active",
    testOnly: true,
  },
];

export function createDefaultWorkspace(
  createdAt = new Date().toISOString(),
): WorkspaceData {
  return {
    schemaVersion: 1,
    weaponName: "Untitled Weapon",
    seed: "bonsai-01",
    growthStep: 0,
    cells: [{ x: 0, y: 0 }],
    placedItems: [],
    items: BUILT_IN_ITEMS.map((item) => ({ ...item })),
    baseStats: {
      power: 10,
      speed: 10,
      stability: 10,
      critical: 5,
    },
    history: [
      {
        id: "created",
        kind: "system",
        message: "Created a new one-cell weapon grid.",
        createdAt,
      },
    ],
    updatedAt: createdAt,
  };
}

export function mergeBuiltInCatalog(workspace: WorkspaceData): WorkspaceData {
  const customItems = workspace.items.filter((item) => !item.builtIn);
  return {
    ...workspace,
    placedItems: migrateGrowthLineage(workspace.placedItems),
    items: [...BUILT_IN_ITEMS.map((item) => ({ ...item })), ...customItems],
  };
}
