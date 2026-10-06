"use client";
// Interactive tree: pan & pinch-zoom like a map, "fly to" a person from the search box.

import {
  Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type NodeMouseHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import type { ParentChild, Partnership } from "@/lib/types/db";
import { layoutTree, NODE_H, NODE_W } from "@/client/layout";
import { PersonNode, type PersonFlowNode } from "./person-node";

export interface CanvasApi {
  flyTo(personId: string): void;
  fit(): void;
}

const nodeTypes = { person: PersonNode };

function edgeStyleForParent(e: ParentChild) {
  const dashed = e.relation !== "biological";
  return { stroke: "var(--edge)", strokeWidth: 3, strokeLinecap: "round" as const, strokeDasharray: dashed ? "6 5" : undefined };
}

function edgeStyleForPartner(p: Partnership) {
  const ended = p.status === "divorced" || p.status === "separated" || p.status === "annulled";
  return { stroke: ended ? "var(--edge)" : "var(--accent)", strokeWidth: 3, strokeDasharray: ended ? "4 6" : undefined };
}

function Canvas({ graph, rootId, selectedId, avatars, onSelect, onReady }: {
  graph: FamilyGraph; rootId: string | null; selectedId: string | null; avatars: Record<string, string>;
  onSelect: (id: string | null) => void; onReady: (api: CanvasApi) => void;
}) {
  const rf = useReactFlow();
  const layout = useMemo(() => layoutTree(graph, rootId), [graph, rootId]);
  const positionsRef = useRef(layout.positions);
  positionsRef.current = layout.positions;

  const nodes = useMemo<PersonFlowNode[]>(
    () => [...layout.positions].map(([id, pos]) => {
      const person = graph.person(id)!;
      return {
        id, type: "person", position: pos, draggable: false,
        selected: id === selectedId,
        data: { person, avatarUrl: person.avatar_media_id ? avatars[person.avatar_media_id] : undefined, isRoot: id === rootId, highlighted: id === selectedId, gen: layout.generation.get(id) ?? 0 },
      };
    }),
    [layout, graph, selectedId, avatars, rootId],
  );

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    const seenPartnerships = new Set<string>();
    for (const id of graph.persons.keys()) {
      for (const e of graph.childEdgesOf(id)) {
        out.push({ id: e.id, source: e.parent_id, target: e.child_id, type: "smoothstep", style: edgeStyleForParent(e), markerEnd: e.relation === "biological" ? undefined : { type: MarkerType.ArrowClosed, color: "var(--edge)" } });
      }
      for (const p of graph.partnershipsOf(id)) {
        if (seenPartnerships.has(p.id)) continue;
        seenPartnerships.add(p.id);
        const a = layout.positions.get(p.person1_id);
        const b = layout.positions.get(p.person2_id);
        if (!a || !b) continue;
        const [left, right] = a.x <= b.x ? [p.person1_id, p.person2_id] : [p.person2_id, p.person1_id];
        out.push({ id: p.id, source: left, target: right, sourceHandle: "r", targetHandle: "l", type: a.y === b.y ? "straight" : "smoothstep", style: edgeStyleForPartner(p) });
      }
    }
    return out;
  }, [graph, layout]);

  const flyTo = useCallback((personId: string) => {
    const pos = positionsRef.current.get(personId);
    if (!pos) return;
    void rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: 1.25, duration: 800 });
  }, [rf]);

  useEffect(() => {
    onReady({ flyTo, fit: () => void rf.fitView({ padding: 0.2, duration: 500 }) });
  }, [flyTo, rf, onReady]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => onSelect(node.id), [onSelect]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
      minZoom={0.08}
      maxZoom={2.2}
      zoomOnDoubleClick
      panOnScroll={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={28} size={1.2} color="var(--border)" />
      <Controls showInteractive={false} position="bottom-right" className="!mb-24 sm:!mb-6" />
    </ReactFlow>
  );
}

export function TreeCanvas(props: Parameters<typeof Canvas>[0]) {
  return (
    <div className="h-full w-full" data-testid="tree-canvas">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
