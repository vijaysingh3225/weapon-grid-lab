"use client";
/* eslint-disable @next/next/no-img-element -- User-provided data URLs need direct browser rendering. */

import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { STRUCTURES, createDefaultWorkspace, mergeBuiltInCatalog } from "./content/catalog";
import {
  buildOccupancyMap,
  calculateStats,
  canPlaceItem,
  chooseGrowthCandidate,
  coordKey,
  detectStructures,
  getGrowthCandidates,
  getItemAnchorAtPoint,
  getItemCenter,
  getItemDimensions,
  isConnected,
  nextRotation,
  seededRandom,
} from "./lib/grid";
import {
  getPersistenceStatus,
  loadWorkspace,
  requestPersistentStorage,
  saveWorkspace,
} from "./lib/storage";
import type {
  Coord,
  HistoryEvent,
  ItemDefinition,
  PlacedItem,
  Rotation,
  StatKey,
  Stats,
  WorkspaceData,
} from "./types";

const CELL_SIZE = 64;
const CELL_PITCH = 72;
const MAX_UNDO = 40;
const STAT_KEYS: StatKey[] = ["power", "speed", "stability", "critical"];

type DragState = {
  itemId: string;
  instanceId?: string;
  rotation: Rotation;
};

type ItemDraft = {
  name: string;
  description: string;
  width: number;
  height: number;
  color: string;
  tags: string;
  growthInfluencePercent: number;
  modifiers: Stats;
  imageDataUrl?: string;
};

const EMPTY_ITEM_DRAFT: ItemDraft = {
  name: "",
  description: "",
  width: 1,
  height: 1,
  color: "#c47b55",
  tags: "",
  growthInfluencePercent: 0,
  modifiers: { power: 0, speed: 0, stability: 0, critical: 0 },
};

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEvent(
  kind: HistoryEvent["kind"],
  message: string,
): HistoryEvent {
  return {
    id: createId("event"),
    kind,
    message,
    createdAt: new Date().toISOString(),
  };
}

function formatModifiers(modifiers: Partial<Stats>): string {
  const entries = STAT_KEYS.flatMap((key) => {
    const value = modifiers[key];
    if (!value) return [];
    return [`${value > 0 ? "+" : ""}${value} ${key}`];
  });
  return entries.length > 0 ? entries.join(" · ") : "No stat change";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "custom-item"
  );
}

function isWorkspaceData(value: unknown): value is WorkspaceData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceData>;
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.cells) &&
    candidate.cells.length > 0 &&
    Array.isArray(candidate.placedItems) &&
    Array.isArray(candidate.items) &&
    Boolean(candidate.baseStats)
  );
}

export function WeaponGridLab() {
  const initialWorkspace = useMemo(
    () => createDefaultWorkspace("2000-01-01T00:00:00.000Z"),
    [],
  );
  const [workspace, setWorkspace] = useState<WorkspaceData>(initialWorkspace);
  const workspaceRef = useRef(workspace);
  const [undoStack, setUndoStack] = useState<WorkspaceData[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [persistentStorage, setPersistentStorage] = useState(false);
  const [showProbabilities, setShowProbabilities] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverCell, setHoverCell] = useState<Coord | null>(null);
  const [selectedCell, setSelectedCell] = useState<Coord | null>({ x: 0, y: 0 });
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(EMPTY_ITEM_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const panGestureRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadWorkspace(), getPersistenceStatus()])
      .then(([stored, isPersistent]) => {
        if (!active) return;
        const next = stored
          ? mergeBuiltInCatalog(stored)
          : createDefaultWorkspace();
        workspaceRef.current = next;
        setWorkspace(next);
        setPersistentStorage(isPersistent);
        setSaveStatus("saved");
        setHydrated(true);
      })
      .catch(() => {
        if (!active) return;
        setHydrated(true);
        setSaveStatus("error");
      });
    return () => {
      active = false;
    };
  }, [initialWorkspace]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      saveWorkspace(workspace)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [hydrated, workspace]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const commit = useCallback(
    (
      update: (current: WorkspaceData) => WorkspaceData,
      event?: HistoryEvent,
    ) => {
      const current = workspaceRef.current;
      const updated = update(current);
      const next: WorkspaceData = {
        ...updated,
        history: event
          ? [event, ...updated.history].slice(0, 80)
          : updated.history,
        updatedAt: new Date().toISOString(),
      };
      setUndoStack((past) => [...past.slice(-(MAX_UNDO - 1)), current]);
      workspaceRef.current = next;
      setSaveStatus("saving");
      setWorkspace(next);
    },
    [],
  );

  const replaceWithoutUndo = useCallback(
    (update: (current: WorkspaceData) => WorkspaceData) => {
      const next = {
        ...update(workspaceRef.current),
        updatedAt: new Date().toISOString(),
      };
      workspaceRef.current = next;
      setSaveStatus("saving");
      setWorkspace(next);
    },
    [],
  );

  const undo = useCallback(() => {
    setUndoStack((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      workspaceRef.current = previous;
      setSaveStatus("saving");
      setWorkspace(previous);
      setSelectedCell(null);
      setSelectedInstanceId(null);
      setNotice("Last change undone.");
      return past.slice(0, -1);
    });
  }, []);

  const candidates = useMemo(
    () =>
      getGrowthCandidates(
        workspace.cells,
        workspace.placedItems,
        workspace.items,
      ),
    [workspace.cells, workspace.placedItems, workspace.items],
  );

  const activeStructures = useMemo(
    () => detectStructures(STRUCTURES, workspace.placedItems, workspace.items),
    [workspace.placedItems, workspace.items],
  );

  const finalStats = useMemo(
    () =>
      calculateStats(
        workspace.baseStats,
        workspace.placedItems,
        workspace.items,
        activeStructures,
      ),
    [workspace.baseStats, workspace.placedItems, workspace.items, activeStructures],
  );

  const occupancy = useMemo(
    () => buildOccupancyMap(workspace.placedItems, workspace.items),
    [workspace.placedItems, workspace.items],
  );

  const selectedPlacement = workspace.placedItems.find(
    (placement) => placement.instanceId === selectedInstanceId,
  );
  const selectedItem = selectedPlacement
    ? workspace.items.find((item) => item.id === selectedPlacement.itemId)
    : undefined;

  const coordinateFromPointer = useCallback(
    (clientX: number, clientY: number, element: HTMLElement): Coord => {
      const bounds = element.getBoundingClientRect();
      const x = (clientX - bounds.left - bounds.width / 2 - pan.x) / zoom;
      const y = (clientY - bounds.top - bounds.height / 2 - pan.y) / zoom;
      return { x: x / CELL_PITCH, y: y / CELL_PITCH };
    },
    [pan, zoom],
  );

  const addManualCell = (candidate: Coord) => {
    commit(
      (current) => ({
        ...current,
        cells: [...current.cells, candidate],
      }),
      createEvent(
        "manual",
        `Added cell (${candidate.x}, ${candidate.y}) manually.`,
      ),
    );
    setSelectedCell(candidate);
  };

  const simulateGrowth = () => {
    const randomValue = seededRandom(workspace.seed, workspace.growthStep);
    const chosen = chooseGrowthCandidate(candidates, randomValue);
    if (!chosen) return;
    commit(
      (current) => ({
        ...current,
        cells: [...current.cells, { x: chosen.x, y: chosen.y }],
        growthStep: current.growthStep + 1,
      }),
      createEvent(
        "growth",
        `Level growth chose (${chosen.x}, ${chosen.y}) at ${(chosen.probability * 100).toFixed(1)}%.`,
      ),
    );
    setSelectedCell({ x: chosen.x, y: chosen.y });
  };

  const removeSelectedCell = () => {
    if (!selectedCell) return;
    if (workspace.cells.length === 1) {
      setNotice("A weapon grid must keep at least one cell.");
      return;
    }
    if (occupancy.has(coordKey(selectedCell))) {
      setNotice("Remove the item occupying this cell first.");
      return;
    }
    const remaining = workspace.cells.filter(
      (cell) => coordKey(cell) !== coordKey(selectedCell),
    );
    if (!isConnected(remaining)) {
      setNotice("That removal would split the weapon grid.");
      return;
    }
    commit(
      (current) => ({ ...current, cells: remaining }),
      createEvent(
        "manual",
        `Removed cell (${selectedCell.x}, ${selectedCell.y}).`,
      ),
    );
    setSelectedCell(null);
  };

  const beginItemDrag = (
    event: DragEvent<HTMLElement>,
    item: ItemDefinition,
    placement?: PlacedItem,
  ) => {
    const state: DragState = {
      itemId: item.id,
      instanceId: placement?.instanceId,
      rotation: placement?.rotation ?? 0,
    };
    event.dataTransfer.effectAllowed = placement ? "move" : "copy";
    event.dataTransfer.setData("text/plain", item.id);
    setDragState(state);
    setSelectedInstanceId(placement?.instanceId ?? null);
  };

  const endItemDrag = () => {
    setDragState(null);
    setHoverCell(null);
  };

  const rotateCarriedItem = useCallback(() => {
    setDragState((current) =>
      current ? { ...current, rotation: nextRotation(current.rotation) } : current,
    );
  }, []);

  const rotatePlacedItem = useCallback(
    (instanceId: string) => {
      const placement = workspaceRef.current.placedItems.find(
        (item) => item.instanceId === instanceId,
      );
      if (!placement) return;
      const rotated = { ...placement, rotation: nextRotation(placement.rotation) };
      if (
        !canPlaceItem(
          rotated,
          workspaceRef.current.cells,
          workspaceRef.current.placedItems,
          workspaceRef.current.items,
          instanceId,
        )
      ) {
        setNotice("The rotated item does not fit in the available cells.");
        return;
      }
      commit(
        (current) => ({
          ...current,
          placedItems: current.placedItems.map((item) =>
            item.instanceId === instanceId ? rotated : item,
          ),
        }),
        createEvent("item", "Rotated a placed item 90°."),
      );
    },
    [commit],
  );

  function removePlacedItem(instanceId: string) {
    const placement = workspaceRef.current.placedItems.find(
      (item) => item.instanceId === instanceId,
    );
    const item = placement
      ? workspaceRef.current.items.find((entry) => entry.id === placement.itemId)
      : undefined;
    if (!placement) return;
    commit(
      (current) => ({
        ...current,
        placedItems: current.placedItems.filter(
          (entry) => entry.instanceId !== instanceId,
        ),
      }),
      createEvent("item", `Removed ${item?.name ?? "an item"}.`),
    );
    setSelectedInstanceId(null);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (dragState) rotateCarriedItem();
        else if (selectedInstanceId) rotatePlacedItem(selectedInstanceId);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      if (event.key === "Delete" && selectedInstanceId) {
        event.preventDefault();
        removePlacedItem(selectedInstanceId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const previewPlacement = useMemo<PlacedItem | undefined>(() => {
    if (!dragState || !hoverCell) return undefined;
    return {
      instanceId: dragState.instanceId ?? "preview",
      itemId: dragState.itemId,
      x: hoverCell.x,
      y: hoverCell.y,
      rotation: dragState.rotation,
    };
  }, [dragState, hoverCell]);

  const previewValid = previewPlacement
    ? canPlaceItem(
        previewPlacement,
        workspace.cells,
        workspace.placedItems,
        workspace.items,
        dragState?.instanceId,
      )
    : false;

  const handleBoardDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragState) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragState.instanceId ? "move" : "copy";
    const item = workspace.items.find(
      (definition) => definition.id === dragState.itemId,
    );
    if (!item) return;
    const point = coordinateFromPointer(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    setHoverCell(getItemAnchorAtPoint(point, item, dragState.rotation));
  };

  const handleBoardDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!previewPlacement || !previewValid) {
      setNotice("That item needs an empty, fully populated footprint.");
      endItemDrag();
      return;
    }
    const definition = workspace.items.find(
      (item) => item.id === previewPlacement.itemId,
    );
    if (!definition) return;

    if (dragState?.instanceId) {
      const moved = { ...previewPlacement, instanceId: dragState.instanceId };
      commit(
        (current) => ({
          ...current,
          placedItems: current.placedItems.map((placement) =>
            placement.instanceId === dragState.instanceId ? moved : placement,
          ),
        }),
        createEvent("item", `Moved ${definition.name}.`),
      );
      setSelectedInstanceId(dragState.instanceId);
    } else {
      const placed = { ...previewPlacement, instanceId: createId("item") };
      commit(
        (current) => ({
          ...current,
          placedItems: [...current.placedItems, placed],
        }),
        createEvent("item", `Placed ${definition.name}.`),
      );
      setSelectedInstanceId(placed.instanceId);
    }
    endItemDrag();
  };

  const handleBoardPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, .placed-item")) return;
    panGestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBoardPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - gesture.x, y: event.clientY - gesture.y };
    panGestureRef.current = {
      ...gesture,
      x: event.clientX,
      y: event.clientY,
    };
    setPan((current) => ({ x: current.x + delta.x, y: current.y + delta.y }));
  };

  const handleBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((current) =>
      Math.min(1.65, Math.max(0.55, current - event.deltaY * 0.001)),
    );
  };

  const saveCustomItem = (event: FormEvent) => {
    event.preventDefault();
    const name = itemDraft.name.trim();
    if (!name) {
      setNotice("Give the item a name before saving it.");
      return;
    }
    const item: ItemDefinition = {
      id: `${slugify(name)}-${Date.now().toString(36)}`,
      name,
      description: itemDraft.description.trim() || "Custom test item.",
      width: itemDraft.width,
      height: itemDraft.height,
      color: itemDraft.color,
      symbol: name.slice(0, 1).toUpperCase(),
      tags: itemDraft.tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
      modifiers: Object.fromEntries(
        STAT_KEYS.filter((key) => itemDraft.modifiers[key] !== 0).map((key) => [
          key,
          itemDraft.modifiers[key],
        ]),
      ),
      growthInfluence: Math.max(0, itemDraft.growthInfluencePercent / 100),
      imageDataUrl: itemDraft.imageDataUrl,
      builtIn: false,
    };
    commit(
      (current) => ({ ...current, items: [...current.items, item] }),
      createEvent("item", `Created custom item “${item.name}”.`),
    );
    setItemDraft(EMPTY_ITEM_DRAFT);
    setItemEditorOpen(false);
    setNotice(`${item.name} added to the library.`);
  };

  const loadItemImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Choose an image file for item artwork.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setNotice("Please keep item artwork under 6 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setItemDraft((current) => ({
        ...current,
        imageDataUrl: String(reader.result),
      }));
    reader.readAsDataURL(file);
  };

  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(workspace.weaponName)}.weapon-grid.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Workspace backup exported.");
  };

  const importWorkspace = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isWorkspaceData(parsed) || !isConnected(parsed.cells)) {
        throw new Error("Invalid workspace");
      }
      const imported = mergeBuiltInCatalog(parsed);
      workspaceRef.current = imported;
      setSaveStatus("saving");
      setWorkspace(imported);
      setUndoStack([]);
      setSelectedCell(null);
      setSelectedInstanceId(null);
      setNotice("Workspace imported successfully.");
    } catch {
      setNotice("That file is not a valid Weapon Grid Lab backup.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const enablePersistentStorage = async () => {
    try {
      const granted = await requestPersistentStorage();
      setPersistentStorage(granted);
      setNotice(
        granted
          ? "Persistent browser storage is enabled."
          : "The browser kept standard local storage mode; exports remain your backup.",
      );
    } catch {
      setNotice("The browser could not change its storage mode.");
    }
  };

  const newWorkspace = () => {
    if (!window.confirm("Start a new one-cell workspace? Export first if you want a backup.")) {
      return;
    }
    const next = createDefaultWorkspace();
    setUndoStack([workspaceRef.current]);
    workspaceRef.current = next;
    setSaveStatus("saving");
    setWorkspace(next);
    setSelectedCell({ x: 0, y: 0 });
    setSelectedInstanceId(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  const previewItem = previewPlacement
    ? workspace.items.find((item) => item.id === previewPlacement.itemId)
    : undefined;
  const previewCenter =
    previewPlacement && previewItem
      ? getItemCenter(previewPlacement, previewItem)
      : undefined;

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><p className="eyebrow">SYSTEM PROTOTYPE / 01</p><h1>Weapon Grid Lab</h1></div>
        </div>

        <label className="weapon-name-field">
          <span>Active weapon</span>
          <input
            value={workspace.weaponName}
            onChange={(event) => replaceWithoutUndo((current) => ({ ...current, weaponName: event.target.value }))}
            aria-label="Weapon name"
          />
        </label>

        <div className="topbar-actions">
          <span className={`save-pill save-${saveStatus}`}><span className="status-dot" />{saveStatus === "loading" ? "Loading" : saveStatus === "saving" ? "Saving" : saveStatus === "error" ? "Save issue" : "Saved locally"}</span>
          <button className="text-button" onClick={newWorkspace}>New</button>
          <button className="text-button" onClick={exportWorkspace}>Export</button>
          <button className="text-button" onClick={() => importInputRef.current?.click()}>Import</button>
          <input ref={importInputRef} className="visually-hidden" type="file" accept=".json,.weapon-grid.json,application/json" onChange={(event) => importWorkspace(event.target.files?.[0])} />
          <button className="icon-button" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo last change">↶</button>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="left-rail panel-rail">
          <section className="panel-section growth-panel">
            <div className="section-heading"><div><p className="eyebrow">LEVEL DEVELOPMENT</p><h2>Growth simulator</h2></div><span className="level-badge">LV {workspace.cells.length}</span></div>
            <p className="panel-copy">Every unique edge-connected opening begins with equal weight. Growth items adjust that weight before normalization.</p>
            <button className="primary-action" onClick={simulateGrowth}><span>Simulate growth</span><small>{candidates.length} possible positions</small></button>
            <div className="seed-row">
              <label><span>Random seed</span><input value={workspace.seed} onChange={(event) => replaceWithoutUndo((current) => ({ ...current, seed: event.target.value, growthStep: 0 }))} /></label>
              <div><span>Roll</span><strong>{workspace.growthStep + 1}</strong></div>
            </div>
            <label className="switch-row"><input type="checkbox" checked={showProbabilities} onChange={(event) => setShowProbabilities(event.target.checked)} /><span>Show frontier probabilities</span></label>
          </section>

          <section className="panel-section stats-panel">
            <div className="section-heading compact"><div><p className="eyebrow">LIVE OUTPUT</p><h2>Weapon statistics</h2></div></div>
            <div className="stat-list">
              {STAT_KEYS.map((key) => {
                const delta = finalStats[key] - workspace.baseStats[key];
                return <div className="stat-row" key={key}><span>{key}</span><label title={`Base ${key}`}><input type="number" value={workspace.baseStats[key]} onChange={(event) => replaceWithoutUndo((current) => ({ ...current, baseStats: { ...current.baseStats, [key]: Number(event.target.value) || 0 } }))} /></label><strong>{finalStats[key]}</strong><small className={delta > 0 ? "positive" : delta < 0 ? "negative" : ""}>{delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</small></div>;
              })}
            </div>
            <p className="stat-legend">BASE · FINAL · CHANGE</p>
          </section>

          <section className="panel-section pattern-panel">
            <div className="section-heading compact"><div><p className="eyebrow">PATTERN DETECTION</p><h2>Structure bonuses</h2></div><span className="count-badge">{activeStructures.length}/{STRUCTURES.length}</span></div>
            <div className="pattern-list">
              {STRUCTURES.map((structure) => {
                const match = activeStructures.find((entry) => entry.structure.id === structure.id);
                return <article className={`pattern-card ${match ? "is-active" : ""}`} key={structure.id}><span className="pattern-state">{match ? "ACTIVE" : "DORMANT"}</span><h3>{structure.name}</h3><p>{structure.description}</p><small>{formatModifiers(structure.modifiers)}</small>{match && <strong>{structure.ability}</strong>}</article>;
              })}
            </div>
          </section>
        </aside>

        <section className="grid-stage" aria-label="Weapon grid workspace">
          <div className="stage-header"><div><p className="eyebrow">GRID STRUCTURE</p><h2>{workspace.cells.length} cells · {workspace.placedItems.length} items</h2></div><div className="stage-hints"><span><kbd>R</kbd> rotate</span><span><kbd>DEL</kbd> remove item</span><span>drag empty space to pan</span></div></div>
          {dragState && <div className="carry-banner"><span>Carrying {workspace.items.find((item) => item.id === dragState.itemId)?.name}</span><button onClick={rotateCarriedItem}>Rotate 90° <kbd>R</kbd></button></div>}
          <div className="grid-viewport" onDragOver={handleBoardDragOver} onDrop={handleBoardDrop} onPointerDown={handleBoardPointerDown} onPointerMove={handleBoardPointerMove} onPointerUp={handleBoardPointerUp} onPointerCancel={handleBoardPointerUp} onWheel={handleWheel}>
            <div className="grid-scene" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {candidates.map((candidate) => <button key={`candidate-${coordKey(candidate)}`} className={`growth-candidate ${candidate.influencedBy ? "is-influenced" : ""}`} style={{ left: candidate.x * CELL_PITCH, top: candidate.y * CELL_PITCH }} onClick={() => addManualCell(candidate)} title={`${(candidate.probability * 100).toFixed(2)}% growth chance${candidate.influencedBy ? ` · boosted by ${candidate.influencedBy}` : ""}`} aria-label={`Add cell at ${candidate.x}, ${candidate.y}`}><b>+</b>{showProbabilities && <small>{(candidate.probability * 100).toFixed(1)}%</small>}</button>)}
              {workspace.cells.map((cell) => {
                const selected = selectedCell && coordKey(selectedCell) === coordKey(cell);
                return <button key={`cell-${coordKey(cell)}`} className={`grid-cell ${selected ? "is-selected" : ""}`} style={{ left: cell.x * CELL_PITCH, top: cell.y * CELL_PITCH }} onClick={() => { setSelectedCell(cell); setSelectedInstanceId(null); }} aria-label={`Grid cell ${cell.x}, ${cell.y}`}><span>{cell.x},{cell.y}</span></button>;
              })}
              {workspace.placedItems.map((placement) => {
                const item = workspace.items.find((definition) => definition.id === placement.itemId);
                if (!item) return null;
                const dimensions = getItemDimensions(item, placement.rotation);
                const center = getItemCenter(placement, item);
                const width = (dimensions.width - 1) * CELL_PITCH + CELL_SIZE;
                const height = (dimensions.height - 1) * CELL_PITCH + CELL_SIZE;
                const originalWidth = (item.width - 1) * CELL_PITCH + CELL_SIZE;
                const originalHeight = (item.height - 1) * CELL_PITCH + CELL_SIZE;
                return <div className={`placed-item ${placement.instanceId === selectedInstanceId ? "is-selected" : ""}`} key={placement.instanceId} draggable onDragStart={(event) => beginItemDrag(event, item, placement)} onDragEnd={endItemDrag} onClick={(event) => { event.stopPropagation(); setSelectedInstanceId(placement.instanceId); setSelectedCell(null); }} style={{ left: center.x * CELL_PITCH, top: center.y * CELL_PITCH, width, height, "--item-color": item.color } as CSSProperties} title={`${item.name} · ${item.width}×${item.height} · ${placement.rotation}°`}><div className="item-art" style={{ width: originalWidth, height: originalHeight, transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)` }}>{item.imageDataUrl ? <img src={item.imageDataUrl} alt="" draggable={false} /> : <span>{item.symbol}</span>}<small>{item.name}</small></div></div>;
              })}
              {previewPlacement && previewItem && previewCenter && <div className={`placement-preview ${previewValid ? "is-valid" : "is-invalid"}`} style={{ left: previewCenter.x * CELL_PITCH, top: previewCenter.y * CELL_PITCH, width: (getItemDimensions(previewItem, previewPlacement.rotation).width - 1) * CELL_PITCH + CELL_SIZE, height: (getItemDimensions(previewItem, previewPlacement.rotation).height - 1) * CELL_PITCH + CELL_SIZE }}>{previewValid ? "PLACE" : "BLOCKED"}</div>}
            </div>
            <div className="viewport-controls"><button onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))} aria-label="Zoom out">−</button><button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>Center</button><button onClick={() => setZoom((value) => Math.min(1.65, value + 0.1))} aria-label="Zoom in">+</button><span>{Math.round(zoom * 100)}%</span></div>
            <div className="grid-legend"><span><i className="legend-equal" /> equal weight</span><span><i className="legend-boost" /> influenced</span></div>
          </div>
          <div className="selection-bar">
            {selectedPlacement && selectedItem ? <><div className="selection-swatch" style={{ background: selectedItem.color }} /><div><strong>{selectedItem.name}</strong><span>{selectedItem.width}×{selectedItem.height} · {selectedPlacement.rotation}° · {formatModifiers(selectedItem.modifiers)}</span></div><button onClick={() => rotatePlacedItem(selectedPlacement.instanceId)}>Rotate</button><button className="danger-button" onClick={() => removePlacedItem(selectedPlacement.instanceId)}>Remove</button></> : selectedCell ? <><div><strong>Cell ({selectedCell.x}, {selectedCell.y})</strong><span>{occupancy.has(coordKey(selectedCell)) ? "Occupied by an item" : "Empty and available"}</span></div><button className="danger-button" onClick={removeSelectedCell}>Remove cell</button></> : <p>Select a cell or item to inspect it.</p>}
          </div>
        </section>

        <aside className="right-rail panel-rail">
          <section className="library-header"><div><p className="eyebrow">ARTIFACT LIBRARY</p><h2>Test items</h2></div><button className="new-item-button" onClick={() => { setItemDraft(EMPTY_ITEM_DRAFT); setItemEditorOpen(true); }}>+ New item</button></section>
          <p className="panel-copy library-copy">Drag an item onto populated cells. Press <kbd>R</kbd> while carrying it to rotate.</p>
          <div className="item-library">
            {workspace.items.map((item) => <article className="library-item" key={item.id} draggable onDragStart={(event) => beginItemDrag(event, item)} onDragEnd={endItemDrag} style={{ "--item-color": item.color } as CSSProperties}><div className="library-art">{item.imageDataUrl ? <img src={item.imageDataUrl} alt="" draggable={false} /> : <span>{item.symbol}</span>}</div><div className="library-info"><div><h3>{item.name}</h3><span>{item.width}×{item.height}</span></div><p>{item.description}</p><small>{formatModifiers(item.modifiers)}</small>{item.growthInfluence > 0 && <b>+{Math.round(item.growthInfluence * 100)}% growth weight</b>}<div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div></article>)}
          </div>
          <section className="storage-card"><div><span className={`storage-icon ${persistentStorage ? "is-on" : ""}`} /><div><strong>{persistentStorage ? "Persistent local storage" : "Standard local storage"}</strong><p>Items, images, and grids autosave in this browser.</p></div></div>{!persistentStorage && <button onClick={enablePersistentStorage}>Request persistence</button>}</section>
          <section className="history-panel"><div className="section-heading compact"><div><p className="eyebrow">EXPERIMENT LOG</p><h2>Recent changes</h2></div></div><ol>{workspace.history.slice(0, 8).map((event) => <li key={event.id}><span className={`event-dot event-${event.kind}`} /><p>{event.message}</p><time>{hydrated ? formatTime(event.createdAt) : "—"}</time></li>)}</ol></section>
        </aside>
      </div>

      {itemEditorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setItemEditorOpen(false)}><section className="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-editor-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">ITEM DEFINITION</p><h2 id="item-editor-title">Create test item</h2></div><button className="modal-close" onClick={() => setItemEditorOpen(false)} aria-label="Close item editor">×</button></header><form onSubmit={saveCustomItem}>
        <div className="form-grid two-column"><label><span>Name</span><input autoFocus value={itemDraft.name} onChange={(event) => setItemDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Ember Relay" /></label><label><span>Tags <small>comma separated</small></span><input value={itemDraft.tags} onChange={(event) => setItemDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="fire, conduit" /></label></div>
        <label><span>Description / ability text</span><textarea value={itemDraft.description} onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this item adds to the weapon…" /></label>
        <div className="form-grid footprint-grid"><label><span>Width</span><input type="number" min="1" max="4" value={itemDraft.width} onChange={(event) => setItemDraft((current) => ({ ...current, width: Math.min(4, Math.max(1, Number(event.target.value) || 1)) }))} /></label><span className="dimension-mark">×</span><label><span>Height</span><input type="number" min="1" max="4" value={itemDraft.height} onChange={(event) => setItemDraft((current) => ({ ...current, height: Math.min(4, Math.max(1, Number(event.target.value) || 1)) }))} /></label><label><span>Color</span><input className="color-input" type="color" value={itemDraft.color} onChange={(event) => setItemDraft((current) => ({ ...current, color: event.target.value }))} /></label><label><span>Growth weight boost %</span><input type="number" min="0" max="500" value={itemDraft.growthInfluencePercent} onChange={(event) => setItemDraft((current) => ({ ...current, growthInfluencePercent: Math.max(0, Number(event.target.value) || 0) }))} /></label></div>
        <fieldset><legend>Stat modifiers</legend><div className="form-grid stat-form-grid">{STAT_KEYS.map((key) => <label key={key}><span>{key}</span><input type="number" value={itemDraft.modifiers[key]} onChange={(event) => setItemDraft((current) => ({ ...current, modifiers: { ...current.modifiers, [key]: Number(event.target.value) || 0 } }))} /></label>)}</div></fieldset>
        <label className="image-upload"><span>Item artwork <small>PNG, JPG, or WebP · max 6 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => loadItemImage(event.target.files?.[0])} /><div style={{ "--preview-color": itemDraft.color } as CSSProperties}>{itemDraft.imageDataUrl ? <img src={itemDraft.imageDataUrl} alt="Item artwork preview" /> : <span>{itemDraft.name.slice(0, 1).toUpperCase() || "?"}</span>}<p>{itemDraft.imageDataUrl ? "Artwork ready" : "Choose artwork or use the color tile"}</p></div></label>
        <footer><button type="button" className="text-button" onClick={() => setItemEditorOpen(false)}>Cancel</button><button type="submit" className="primary-action compact-action">Add to library</button></footer>
      </form></section></div>}
      {notice && <div className="notice-toast" role="status">{notice}</div>}
    </main>
  );
}
