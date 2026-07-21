import { describe, expect, it } from "vitest";
import type { PlacedItem } from "../types";
import { migrateGrowthLineage } from "./catalog";

describe("growth lineage migration", () => {
  it("separates legacy node sides into independent streams and marks each end", () => {
    const placements: PlacedItem[] = [
      { instanceId: "node", itemId: "growth-node", x: 0, y: 0, rotation: 0 },
      { instanceId: "east-1", itemId: "growth-branch", x: 1, y: 0, rotation: 0 },
      { instanceId: "east-2", itemId: "growth-branch", x: 2, y: 0, rotation: 0 },
      { instanceId: "south-1", itemId: "growth-branch", x: 0, y: 1, rotation: 0 },
    ];

    const migrated = migrateGrowthLineage(placements);
    const east1 = migrated.find(({ instanceId }) => instanceId === "east-1")!;
    const east2 = migrated.find(({ instanceId }) => instanceId === "east-2")!;
    const south1 = migrated.find(({ instanceId }) => instanceId === "south-1")!;

    expect(east1.growthParentInstanceId).toBe("node");
    expect(east1.growthOriginNodeInstanceId).toBe("node");
    expect(east2.growthParentInstanceId).toBe("east-1");
    expect(east2.growthOriginNodeInstanceId).toBe("node");
    expect(east2.growthStreamId).toBe(east1.growthStreamId);
    expect(south1.growthStreamId).not.toBe(east1.growthStreamId);
    expect(east2.itemId).toBe("growth-tip");
    expect(south1.itemId).toBe("growth-tip");
  });

  it("preserves lineage that was already assigned", () => {
    const placements: PlacedItem[] = [
      { instanceId: "node", itemId: "growth-node", x: 0, y: 0, rotation: 0 },
      {
        instanceId: "tip",
        itemId: "growth-tip",
        x: 1,
        y: 0,
        rotation: 0,
        growthStreamId: "stream-kept",
        growthParentInstanceId: "node",
      },
    ];

    expect(migrateGrowthLineage(placements)).toEqual(placements);
  });
});
