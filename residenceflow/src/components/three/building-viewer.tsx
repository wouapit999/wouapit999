"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Edges, Html, OrbitControls } from "@react-three/drei";
import type { BuildingModel, UnitBox } from "@/domain/building-3d";
import { ROOM_COLORS, STATUS_COLORS } from "@/domain/building-3d";

export interface ViewerLabels {
  floor: string;
  ground: string;
  allFloors: string;
  explode: string;
  interior: string;
  close: string;
  openUnit: string;
  legend: string;
  tenant: string;
  rent: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  block: string;
  noUnits: string;
  controlsHint: string;
  statuses: Record<string, string>;
  rooms: Record<string, string>;
  types: Record<string, string>;
}

interface Props {
  model: BuildingModel;
  name: string;
  labels: ViewerLabels;
  initialUnitId?: string | null;
  canOpenUnits: boolean;
}

const EXPLODE_FACTOR = 2.2;

/** Translates a room key, keeping the numbering of "bedroom 2" style raw labels. */
function roomLabel(labels: ViewerLabels) {
  return (key: string, raw: string) => (labels.rooms[key] ?? key).replace("{n}", raw.replace(/\D/g, ""));
}

/**
 * Smoothly re-frames the camera when the focus target or distance changes (unit selected,
 * floors exploded), keeping the user's current viewing direction.
 */
function CameraRig({ target, distance }: { target: [number, number, number]; distance: number }) {
  const { camera, controls } = useThree();
  const goal = useMemo(() => new THREE.Vector3(...target), [target]);
  useFrame(() => {
    const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!ctl) return;
    ctl.target.lerp(goal, 0.12);
    const dir = camera.position.clone().sub(ctl.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0.6, 0.5, 0.7).normalize();
    const desired = ctl.target.clone().add(dir.multiplyScalar(distance));
    camera.position.lerp(desired, 0.08);
    ctl.update();
  });
  return null;
}

function UnitMesh({ u, yOffset, selected, hovered, dimmed, onHover, onSelect, labels }: {
  u: UnitBox; yOffset: number; selected: boolean; hovered: boolean; dimmed: boolean;
  onHover: (id: string | null) => void; onSelect: (id: string) => void; labels: ViewerLabels;
}) {
  const color = STATUS_COLORS[u.status] ?? "#cbd5e1";
  return (
    <group position={[u.x, u.y + yOffset + u.h / 2, u.z]}>
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); onHover(u.id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onSelect(u.id); }}
      >
        <boxGeometry args={[u.w, u.h, u.d]} />
        <meshStandardMaterial color={color} transparent opacity={dimmed ? 0.18 : selected ? 0.14 : 0.92} depthWrite={!selected} emissive={hovered && !selected ? color : "#000000"} emissiveIntensity={hovered && !selected ? 0.3 : 0} />
        <Edges color={selected ? "#0f172a" : "#334155"} threshold={15} lineWidth={selected ? 2 : 1} />
      </mesh>
      {!dimmed && (
        <Html position={[0, 0, u.d / 2 + 0.05]} center distanceFactor={30} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <span className="rounded bg-white/85 px-1 text-[11px] font-semibold text-slate-900 shadow-sm">{u.number}</span>
        </Html>
      )}
      {hovered && !selected && (
        <Html position={[0, u.h / 2 + 0.3, 0]} center distanceFactor={25} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-md bg-slate-900/90 px-2 py-1 text-xs text-white shadow">
            <strong>{u.number}</strong> · {labels.statuses[u.status] ?? u.status}
            {u.tenantName ? ` · ${u.tenantName}` : ""}
          </div>
        </Html>
      )}
    </group>
  );
}

function Interior({ u, labelFor }: { u: UnitBox; labelFor: (key: string, raw: string) => string }) {
  // Rooms drawn as low translucent volumes inside the unit footprint, origin at the unit's corner.
  const x0 = u.x - u.w / 2;
  const z0 = u.z - u.d / 2;
  return (
    <group>
      {u.rooms.map((r, i) => (
        <group key={i} position={[x0 + r.x + r.w / 2, u.y + 0.6, z0 + r.z + r.d / 2]}>
          <mesh>
            <boxGeometry args={[Math.max(0.3, r.w - 0.12), 1.2, Math.max(0.3, r.d - 0.12)]} />
            <meshStandardMaterial color={ROOM_COLORS[r.key] ?? "#e2e8f0"} transparent opacity={0.85} />
            <Edges color="#475569" />
          </mesh>
          <Html position={[0, 0.9, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
            <span className="whitespace-nowrap rounded bg-slate-900/80 px-1 text-[10px] text-white">{labelFor(r.key, r.label)}</span>
          </Html>
        </group>
      ))}
    </group>
  );
}

function Scene({ model, floorFilter, explode, selectedId, hoveredId, setHovered, setSelected, labels }: {
  model: BuildingModel; floorFilter: number | null; explode: boolean; selectedId: string | null; hoveredId: string | null;
  setHovered: (id: string | null) => void; setSelected: (id: string | null) => void; labels: ViewerLabels;
}) {
  const yFor = (floor: number) => (explode ? floor * model.floorHeight * (EXPLODE_FACTOR - 1) : 0);
  const selected = model.units.find((u) => u.id === selectedId) ?? null;
  const showInterior = !!selected;
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[20, 40, 20]} intensity={1.1} castShadow />
      <directionalLight position={[-20, 20, -10]} intensity={0.4} />
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[model.bounds.w / 2, -0.02, model.bounds.d / 2]} onClick={() => setSelected(null)}>
        <planeGeometry args={[model.bounds.w + 30, model.bounds.d + 30]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {/* slabs */}
      {model.slabs.map((s, i) => {
        const dim = (floorFilter !== null && s.floor !== floorFilter) || (!!selected && s.floor > selected.floor);
        return (
          <group key={i} position={[s.x, s.y + yFor(s.floor) + 0.125, s.z]}>
            <mesh>
              <boxGeometry args={[s.w, 0.25, s.d]} />
              <meshStandardMaterial color="#cbd5e1" transparent opacity={dim ? 0.15 : 1} />
            </mesh>
            {!dim && (
              <Html position={[-s.w / 2 - 0.4, 0.5, s.d / 2]} distanceFactor={30} style={{ pointerEvents: "none" }} zIndexRange={[5, 0]}>
                <span className="whitespace-nowrap rounded bg-slate-700/85 px-1.5 py-0.5 text-[10px] text-white">
                  {s.floor === 0 ? labels.ground : `${labels.floor} ${s.floor}`}{s.block ? ` · ${s.block}` : ""}
                </span>
              </Html>
            )}
          </group>
        );
      })}
      {/* cores */}
      {model.cores.map((c, i) => (
        <mesh key={i} position={[c.x, c.h / 2 + (explode ? (model.floors.length - 1) * model.floorHeight * (EXPLODE_FACTOR - 1) / 2 : 0), c.z]}>
          <boxGeometry args={[c.w, c.h + (explode ? (model.floors.length - 1) * model.floorHeight * (EXPLODE_FACTOR - 1) : 0), c.d]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.55} />
          <Edges color="#475569" />
        </mesh>
      ))}
      {/* roof */}
      {model.blocks.map((b, i) => {
        const top = model.slabs.filter((s) => s.block === b).sort((a, c) => c.floor - a.floor)[0];
        if (!top) return null;
        return (
          <mesh key={`roof-${i}`} position={[top.x, top.y + model.floorHeight + yFor(top.floor) + 0.1, top.z]}>
            <boxGeometry args={[top.w + 0.4, 0.2, top.d + 0.4]} />
            <meshStandardMaterial color="#64748b" transparent opacity={floorFilter !== null || showInterior ? 0.08 : 0.9} />
          </mesh>
        );
      })}
      {/* units */}
      {model.units.map((u) => (
        <UnitMesh
          key={u.id}
          u={u}
          yOffset={yFor(u.floor)}
          selected={u.id === selectedId}
          hovered={u.id === hoveredId}
          dimmed={(floorFilter !== null && u.floor !== floorFilter) || (showInterior && u.id !== selectedId)}
          onHover={setHovered}
          onSelect={(id) => setSelected(id === selectedId ? null : id)}
          labels={labels}
        />
      ))}
      {selected && <group position={[0, yFor(selected.floor), 0]}><Interior u={selected} labelFor={roomLabel(labels)} /></group>}
    </>
  );
}

export function BuildingViewer({ model, name, labels, initialUnitId, canOpenUnits }: Props) {
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [explode, setExplode] = useState(false);
  const [selectedId, setSelected] = useState<string | null>(initialUnitId ?? null);
  const [hoveredId, setHovered] = useState<string | null>(null);
  const selected = useMemo(() => model.units.find((u) => u.id === selectedId) ?? null, [model.units, selectedId]);
  const yShift = (floor: number) => (explode ? floor * model.floorHeight * (EXPLODE_FACTOR - 1) : 0);
  const totalH = explode ? model.bounds.h * EXPLODE_FACTOR : model.bounds.h;
  const camTarget: [number, number, number] = selected
    ? [selected.x, selected.y + yShift(selected.floor) + selected.h / 2, selected.z]
    : [model.bounds.w / 2, totalH / 2, model.bounds.d / 2];
  const dist = selected
    ? Math.max(selected.w, selected.d) * 2.2 + 6
    : Math.max(model.bounds.w, totalH * 1.4, model.bounds.d) * 1.6 + 10;
  const statusesPresent = [...new Set(model.units.map((u) => u.status))];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900" data-testid="building-3d">
        <Canvas shadows camera={{ position: [camTarget[0] + dist * 0.8, model.bounds.h + dist * 0.5, camTarget[2] + dist * 0.9], fov: 40 }}>
            <Scene
              model={model}
              floorFilter={floorFilter}
              explode={explode}
              selectedId={selectedId}
              hoveredId={hoveredId}
              setHovered={setHovered}
              setSelected={setSelected}
              labels={labels}
            />
          <OrbitControls maxPolarAngle={Math.PI / 2.05} makeDefault />
          <CameraRig target={camTarget} distance={dist} />
        </Canvas>
        {/* toolbar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto flex flex-wrap gap-1 rounded-md bg-white/90 p-1 shadow dark:bg-slate-800/90">
            <button type="button" onClick={() => setFloorFilter(null)} className={`rounded px-2 py-1 text-xs ${floorFilter === null ? "bg-[var(--brand)] text-white" : "hover:bg-slate-100 dark:hover:bg-slate-700"}`}>{labels.allFloors}</button>
            {model.floors.map((f) => (
              <button key={f} type="button" onClick={() => setFloorFilter(f)} className={`rounded px-2 py-1 text-xs ${floorFilter === f ? "bg-[var(--brand)] text-white" : "hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
                {f === 0 ? labels.ground : `${labels.floor} ${f}`}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 px-2 text-xs">
              <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} className="accent-[var(--brand)]" /> {labels.explode}
            </label>
          </div>
          <div className="pointer-events-auto rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow dark:bg-slate-800/90 dark:text-slate-300">{labels.controlsHint}</div>
        </div>
        {model.units.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-slate-600">{labels.noUnits}</div>
        )}
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{labels.legend}</div>
          <ul className="space-y-1">
            {statusesPresent.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: STATUS_COLORS[s] ?? "#cbd5e1" }} aria-hidden />
                {labels.statuses[s] ?? s} <span className="text-xs text-slate-500">({model.units.filter((u) => u.status === s).length})</span>
              </li>
            ))}
          </ul>
        </div>
        {selected ? (
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900" data-testid="unit-panel">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-semibold">{name} · {selected.number}</div>
                <div className="text-xs text-slate-500">
                  {selected.floor === 0 ? labels.ground : `${labels.floor} ${selected.floor}`}{selected.block ? ` · ${labels.block} ${selected.block}` : ""} · {labels.types[selected.type] ?? selected.type}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-700" aria-label={labels.close}>✕</button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-500">{labels.bedrooms}</dt><dd>{selected.bedrooms}</dd>
              <dt className="text-slate-500">{labels.bathrooms}</dt><dd>{selected.bathrooms}</dd>
              <dt className="text-slate-500">{labels.area}</dt><dd>{selected.area ? `${selected.area} m²` : "—"}</dd>
              {selected.rent && <><dt className="text-slate-500">{labels.rent}</dt><dd>{selected.rent}</dd></>}
              {selected.tenantName && <><dt className="text-slate-500">{labels.tenant}</dt><dd>{selected.tenantName}</dd></>}
            </dl>
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{labels.interior}</div>
              <ul className="flex flex-wrap gap-1">
                {selected.rooms.map((r, i) => (
                  <li key={i} className="rounded px-2 py-0.5 text-xs" style={{ background: ROOM_COLORS[r.key] ?? "#e2e8f0" }}>
                    {(labels.rooms[r.key] ?? r.key).replace("{n}", r.label.replace(/\D/g, ""))} · {Math.round(r.w * r.d)} m²
                  </li>
                ))}
              </ul>
            </div>
            {canOpenUnits && (
              <Link href={`/units/${selected.id}`} className="mt-3 inline-flex rounded-md bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110">{labels.openUnit}</Link>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-600">{labels.interior}: {labels.controlsHint}</div>
        )}
      </aside>
    </div>
  );
}
