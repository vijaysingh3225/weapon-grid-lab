import type {
  ItemDefinition,
  StructureDefinition,
  WorkspaceData,
} from "../types";

export const BUILT_IN_ITEMS: ItemDefinition[] = [
  {
    id: "iron-shard",
    name: "Iron Shard",
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
      "Raises the relative growth weight of exposed positions touching it by 10%.",
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
      "Place an Iron Shard edge-adjacent to a Growth Node in either orientation.",
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
    items: [...BUILT_IN_ITEMS.map((item) => ({ ...item })), ...customItems],
  };
}
