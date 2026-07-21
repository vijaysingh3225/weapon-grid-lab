import { describe, expect, it } from "vitest";
import { BUILT_IN_ITEMS, STRUCTURES } from "../content/catalog";
import type { Coord, PlacedItem } from "../types";
import {
  canPlaceItem,
  chooseGrowthCandidate,
  chooseGrowthBranchCandidate,
  detectStructures,
  getGrowthConnectionStreamId,
  getGrowthBranchCandidates,
  getGrowthCandidates,
  getItemAnchorAtPoint,
  getItemCenter,
  getItemDimensions,
  isConnected,
  seededRandom,
} from "./grid";

describe("growth frontier", () => {
  it("gives a one-cell grid four equal orthogonal candidates", () => {
    const candidates = getGrowthCandidates([{ x: 0, y: 0 }], [], BUILT_IN_ITEMS);
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.probability === 0.25)).toBe(true);
    expect(candidates.map(({ x, y }) => `${x},${y}`)).not.toContain("1,1");
  });

  it("consolidates a candidate even when it touches multiple cells", () => {
    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const candidates = getGrowthCandidates(cells, [], BUILT_IN_ITEMS);
    expect(candidates.filter(({ x, y }) => x === 1 && y === 1)).toHaveLength(1);
    expect(candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1);
  });

  it("normalizes a growth-node boost without stacking", () => {
    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const placements: PlacedItem[] = [
      { instanceId: "a", itemId: "growth-node", x: 0, y: 0, rotation: 0 },
      { instanceId: "b", itemId: "growth-node", x: 1, y: 1, rotation: 0 },
    ];
    const candidates = getGrowthCandidates(cells, placements, BUILT_IN_ITEMS);
    const sharedCandidate = candidates.find(({ x, y }) => x === 1 && y === 0);
    expect(sharedCandidate?.weight).toBeCloseTo(1.1);
    expect(candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1);
  });

  it("offers empty populated cells beside a growth node", () => {
    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const placements: PlacedItem[] = [
      { instanceId: "node", itemId: "growth-node", x: 0, y: 0, rotation: 0 },
      { instanceId: "blocked", itemId: "iron-shard", x: 0, y: -1, rotation: 0 },
    ];

    expect(
      getGrowthBranchCandidates(cells, placements, BUILT_IN_ITEMS),
    ).toEqual([
      {
        source: { x: 0, y: 0 },
        target: { x: -1, y: 0 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 0, y: 0 },
        target: { x: 1, y: 0 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 0, y: 0 },
        target: { x: 0, y: 1 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
    ]);
  });

  it("extends explicit reachable tips without growing from branch segments", () => {
    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 2, y: -1 },
      { x: 2, y: 1 },
      { x: 3, y: 0 },
    ];
    const placements: PlacedItem[] = [
      { instanceId: "node", itemId: "growth-node", x: 0, y: 0, rotation: 0 },
      {
        instanceId: "branch-1",
        itemId: "growth-branch",
        x: 1,
        y: 0,
        rotation: 0,
        growthStreamId: "stream-a",
        growthParentInstanceId: "node",
      },
      {
        instanceId: "tip",
        itemId: "growth-tip",
        x: 2,
        y: 0,
        rotation: 0,
        growthStreamId: "stream-a",
        growthParentInstanceId: "branch-1",
      },
    ];
    const candidates = getGrowthBranchCandidates(
      cells,
      placements,
      BUILT_IN_ITEMS,
    );

    expect(candidates).toEqual([
      {
        source: { x: 0, y: 0 },
        target: { x: 0, y: -1 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 2, y: 0 },
        target: { x: 2, y: -1 },
        sourceInstanceId: "tip",
        sourceItemId: "growth-tip",
        growthStreamId: "stream-a",
      },
      {
        source: { x: 0, y: 0 },
        target: { x: -1, y: 0 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 2, y: 0 },
        target: { x: 3, y: 0 },
        sourceInstanceId: "tip",
        sourceItemId: "growth-tip",
        growthStreamId: "stream-a",
      },
      {
        source: { x: 0, y: 0 },
        target: { x: 0, y: 1 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 2, y: 0 },
        target: { x: 2, y: 1 },
        sourceInstanceId: "tip",
        sourceItemId: "growth-tip",
        growthStreamId: "stream-a",
      },
    ]);
    expect(candidates.map(({ target }) => target)).not.toContainEqual({ x: 1, y: -1 });
    expect(candidates.map(({ target }) => target)).not.toContainEqual({ x: 1, y: 1 });
    expect(candidates.map(({ sourceInstanceId }) => sourceInstanceId)).not.toContain("branch-1");
  });

  it("keeps adjacent branch streams visually independent", () => {
    const branchA: PlacedItem = {
      instanceId: "branch-a",
      itemId: "growth-branch",
      x: 1,
      y: 0,
      rotation: 0,
      growthStreamId: "stream-a",
      growthParentInstanceId: "node",
    };
    const branchB: PlacedItem = {
      instanceId: "branch-b",
      itemId: "growth-branch",
      x: 1,
      y: 1,
      rotation: 0,
      growthStreamId: "stream-b",
      growthParentInstanceId: "branch-a",
    };

    expect(getGrowthConnectionStreamId(branchA, branchB)).toBeUndefined();
  });

  it("stops a node from creating more than four persistent streams", () => {
    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    const placements: PlacedItem[] = [
      { instanceId: "node", itemId: "growth-node", x: 0, y: 0, rotation: 0 },
      ...["a", "b", "c", "d"].map((label, index): PlacedItem => ({
        instanceId: `old-${label}`,
        itemId: "growth-branch",
        x: index + 10,
        y: 10,
        rotation: 0,
        growthStreamId: `stream-${label}`,
        growthOriginNodeInstanceId: "node",
      })),
    ];

    expect(
      getGrowthBranchCandidates(cells, placements, BUILT_IN_ITEMS),
    ).toEqual([]);
  });

  it("requires a connected growth node and chooses branch growth repeatably", () => {
    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const orphanBranch: PlacedItem[] = [
      { instanceId: "branch", itemId: "growth-branch", x: 1, y: 0, rotation: 0 },
      { instanceId: "tip", itemId: "growth-tip", x: 2, y: 0, rotation: 0 },
    ];
    expect(
      getGrowthBranchCandidates(cells, orphanBranch, BUILT_IN_ITEMS),
    ).toEqual([]);

    const choices = [
      {
        source: { x: 0, y: 0 },
        target: { x: -1, y: 0 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 0, y: 0 },
        target: { x: 1, y: 0 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
      {
        source: { x: 0, y: 0 },
        target: { x: 0, y: 1 },
        sourceInstanceId: "node",
        sourceItemId: "growth-node",
      },
    ];
    const randomValue = seededRandom("branch-seed", 3);
    expect(chooseGrowthBranchCandidate(choices, randomValue)).toEqual(
      chooseGrowthBranchCandidate(choices, randomValue),
    );
  });
});

describe("items and structures", () => {
  it("rotates rectangular item dimensions and validates full footprints", () => {
    const bar = BUILT_IN_ITEMS.find((item) => item.id === "stabilizer-bar")!;
    expect(getItemDimensions(bar, 0)).toEqual({ width: 1, height: 2 });
    expect(getItemDimensions(bar, 90)).toEqual({ width: 2, height: 1 });

    const cells: Coord[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const horizontal: PlacedItem = {
      instanceId: "bar",
      itemId: bar.id,
      x: 0,
      y: 0,
      rotation: 90,
    };
    expect(canPlaceItem(horizontal, cells, [], BUILT_IN_ITEMS)).toBe(true);
    expect(canPlaceItem({ ...horizontal, rotation: 0 }, cells, [], BUILT_IN_ITEMS)).toBe(false);
  });

  it("centers even-sized items between their occupied cells", () => {
    const core = BUILT_IN_ITEMS.find((item) => item.id === "core-plate")!;
    const bar = BUILT_IN_ITEMS.find((item) => item.id === "stabilizer-bar")!;

    expect(getItemAnchorAtPoint({ x: 0.5, y: 0.5 }, core, 0)).toEqual({
      x: 0,
      y: 0,
    });
    expect(
      getItemCenter({ x: 0, y: 0, rotation: 0 }, core),
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(getItemAnchorAtPoint({ x: 0, y: 0.5 }, bar, 0)).toEqual({
      x: 0,
      y: 0,
    });
    expect(getItemAnchorAtPoint({ x: 0.5, y: 0 }, bar, 90)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("recognizes an exact-item structure after rotation", () => {
    const placements: PlacedItem[] = [
      { instanceId: "iron", itemId: "iron-shard", x: 2, y: 3, rotation: 0 },
      { instanceId: "growth", itemId: "growth-node", x: 2, y: 4, rotation: 0 },
    ];
    const matches = detectStructures(STRUCTURES, placements, BUILT_IN_ITEMS);
    expect(matches.map((match) => match.structure.id)).toContain("resonant-pair");
  });
});

describe("grid safety and repeatability", () => {
  it("rejects disconnected structures", () => {
    expect(isConnected([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(isConnected([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });

  it("produces repeatable seeded growth choices", () => {
    const candidates = getGrowthCandidates([{ x: 0, y: 0 }], [], BUILT_IN_ITEMS);
    const first = chooseGrowthCandidate(candidates, seededRandom("same-seed", 4));
    const second = chooseGrowthCandidate(candidates, seededRandom("same-seed", 4));
    expect(first).toEqual(second);
  });
});
