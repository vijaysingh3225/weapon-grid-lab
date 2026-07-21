export type Rotation = 0 | 90 | 180 | 270;

export type StatKey = "power" | "speed" | "stability" | "critical";

export type Stats = Record<StatKey, number>;

export type Coord = {
  x: number;
  y: number;
};

export type ItemDefinition = {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  color: string;
  symbol: string;
  tags: string[];
  modifiers: Partial<Stats>;
  growthInfluence: number;
  imageDataUrl?: string;
  builtIn?: boolean;
};

export type PlacedItem = {
  instanceId: string;
  itemId: string;
  x: number;
  y: number;
  rotation: Rotation;
  growthStreamId?: string;
  growthParentInstanceId?: string;
  growthOriginNodeInstanceId?: string;
};

export type PatternRequirement = Coord & {
  itemIds?: string[];
  tagsAny?: string[];
};

export type StructureDefinition = {
  id: string;
  name: string;
  description: string;
  requirements: PatternRequirement[];
  allowRotations: boolean;
  allowReflections: boolean;
  modifiers: Partial<Stats>;
  ability: string;
  testOnly?: boolean;
};

export type StructureMatch = {
  structure: StructureDefinition;
  instanceIds: string[];
  rotation: Rotation;
  reflected: boolean;
};

export type GrowthCandidate = Coord & {
  weight: number;
  probability: number;
  influencedBy?: string;
};

export type HistoryEvent = {
  id: string;
  kind: "growth" | "manual" | "item" | "system";
  message: string;
  createdAt: string;
};

export type WorkspaceData = {
  schemaVersion: 1;
  weaponName: string;
  seed: string;
  growthStep: number;
  cells: Coord[];
  placedItems: PlacedItem[];
  items: ItemDefinition[];
  baseStats: Stats;
  history: HistoryEvent[];
  updatedAt: string;
};
