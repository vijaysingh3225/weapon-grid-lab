import { describe, expect, it } from "vitest";
import { BUILT_IN_ITEMS, STRUCTURES } from "../content/catalog";
import type { Coord, PlacedItem } from "../types";
import {
  canPlaceItem,
  chooseGrowthCandidate,
  detectStructures,
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
