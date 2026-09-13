/**
 * Agastya — FloodMap Component
 * Interactive Leaflet map with flood depth colour overlays,
 * manhole markers, pipe network lines, multi-node choke indicators,
 * interactive 2-point shortest/safest route selection HUD, and bypassed flood corridor visualization.
 */

import { useEffect, Fragment, useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { NodeDepth, NetworkEdge, PathCoord, RouteResponse, PotholeHazard } from '../lib/api';
import { TOP_15_DESTINATIONS } from '../lib/networkData';

interface FloodMapProps {
  nodes: NodeDepth[];
  edges: NetworkEdge[];
  potholes?: PotholeHazard[];
  routePath: PathCoord[];
  normalPathCoords?: PathCoord[];
  routeResult?: RouteResponse | null;
  showRoute: boolean;
  chokeMode: boolean;
  blockedNodes: string[];
  onNodeClick: (nodeId: string) => void;
  onSelectOrigin?: (nodeId: string) => void;
  onSelectTarget?: (nodeId: string) => void;
  onSwapRoute?: () => void;
  onClearRoute?: () => void;
  center: [number, number];
  zoom: number;
  routeSource?: string;
  routeTarget?: string;
  isAutoSim?: boolean;
  autoSimStep?: number;
  autoSimMessage?: string;
  simAmbulanceCoord?: { lat: number; lon: number; name?: string; progress: number } | null;
  onStopAutoSim?: () => void;
  onClearBlockedNodes?: () => void;
  onToggleBlockNode?: (nodeId: string) => void;
  onChokeActiveRoute?: () => void;
}

// Flood depth → colour mapping (matches standard hydrological risk legend)
function getDepthColor(depth: number): string {
  if (depth >= 30) return '#ef4444';   // CRITICAL — red
  if (depth >= 20) return '#f97316';   // HIGH — orange
  if (depth >= 10) return '#f59e0b';   // MEDIUM — amber
  return '#10b981';                     // SAFE — green (No blue nodes)
}

function getDepthRadius(depth: number, isWaypoint: boolean = false): number {
  if (isWaypoint) {
    if (depth >= 30) return 6;
    if (depth >= 20) return 5;
    if (depth >= 10) return 4;
    return 3;
  }
  if (depth >= 30) return 13;
  if (depth >= 20) return 11;
  if (depth >= 10) return 9;
  if (depth >= 3) return 7;
  return 6;
}

function getDepthOpacity(depth: number): number {
  if (depth >= 30) return 0.9;
  if (depth >= 20) return 0.8;
  if (depth >= 10) return 0.7;
  if (depth >= 3) return 0.6;
  return 0.4;
}

// Component to handle map view updates
function MapUpdater({ center, zoom, routePath = [] }: { center: [number, number]; zoom: number; routePath?: PathCoord[] }) {
  const map = useMap();
  const routeKey = useMemo(() => {
    if (!routePath || routePath.length <= 1) return '';
    const start = routePath[0];
    const end = routePath[routePath.length - 1];
    return `${start.lat}_${start.lon}_${end.lat}_${end.lon}_${routePath.length}`;
  }, [routePath]);

  useEffect(() => {
    if (routeKey) {
      const bounds = routePath.map(p => [p.lat, p.lon] as [number, number]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else {
      map.setView(center, zoom);
    }
  }, [center, zoom, routeKey, map]);
  return null;
}

// Track zoom level changes dynamically
function ZoomTracker({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
  });
  return null;
}

export default function FloodMap({
  nodes,
  edges,
  potholes = [],
  routePath,
  normalPathCoords: _normalPathCoords = [],
  routeResult,
  showRoute,
  chokeMode,
  blockedNodes,
  onNodeClick,
  onSelectOrigin,
  onSelectTarget,
  onSwapRoute,
  onClearRoute,
  center,
  zoom,
  routeSource,
  routeTarget,
  isAutoSim = false,
  autoSimStep = 0,
  autoSimMessage = '',
  simAmbulanceCoord = null,
  onStopAutoSim,
  onClearBlockedNodes,
  onToggleBlockNode,
  onChokeActiveRoute,
}: FloodMapProps) {
  const blockedSet = useMemo(() => new Set(blockedNodes), [blockedNodes]);
  const [showPotholes, setShowPotholes] = useState<boolean>(true);
  const [showChokeModal, setShowChokeModal] = useState<boolean>(false);
  const [chokeDirection, setChokeDirection] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [, setCurrentZoom] = useState<number>(zoom);
  const [showNodesWhenRouting, setShowNodesWhenRouting] = useState<boolean>(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState<boolean>(false);
  const [dismissedBottomModal, setDismissedBottomModal] = useState<boolean>(false);
  const [tileLayer, setTileLayer] = useState<'dark' | 'satellite' | 'osm'>('dark');
  const isSafeRouteActive = Boolean(showRoute && routeResult && routeResult.reachable && routePath.length > 1);

  const cartoKey = (import.meta as any).env?.VITE_CARTO_API_KEY || '';

  const TILE_URLS = {
    dark: cartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  };
  const TILE_ATTRS = {
    dark: cartoKey ? '© <a href="https://carto.com">CartoDB</a>' : 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    satellite: '© <a href="https://www.esri.com">Esri</a>',
    osm: '© <a href="https://www.openstreetmap.org">OpenStreetMap</a>',
  };


  // Direct 100% reliable choke toggle helper
  const toggleChoke = (nodeId: string) => {
    if (onToggleBlockNode) {
      onToggleBlockNode(nodeId);
    } else {
      onNodeClick(nodeId);
    }
  };

  // Map each pothole to the closest node ID in network (cached by length since coords are static)
  const potholeNodeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const ph of potholes) {
      let closestId = "";
      let minDist = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const d = Math.hypot(n.lat - ph.lat, n.lon - ph.lon);
        if (d < minDist) {
          minDist = d;
          closestId = n.node_id;
        }
      }
      if (closestId) m.set(ph.id, closestId);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [potholes, nodes.length]);

  // Memoize multi-polyline positions to render 14,000+ segments in 1 single SVG path
  const multiPolylinePositions = useMemo(() => {
    return edges.map(edge => [
      [edge.from_lat, edge.from_lon],
      [edge.to_lat, edge.to_lon],
    ] as [number, number][]);
  }, [edges]);

  // Memoize dropdown junctions to avoid rendering thousands of option DOM elements
  const dropdownLandmarkNodes = useMemo(() => {
    return nodes.filter(n => !n.node_id.startsWith('mesh_') && !n.node_id.includes('_wp') && !TOP_15_DESTINATIONS.some((d: any) => d.id === n.node_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  const nodeDepthMap = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      m.set(nodes[i].node_id, nodes[i].depth_cm);
    }
    return m;
  }, [nodes]);

  // Hide safe/low-risk nodes from the screen — show only flooded risk nodes (depth >= 10cm), blocked nodes, and route endpoints
  const filteredNodes = useMemo(() => {
    return nodes.filter(n => {
      if (n.node_id === routeSource || n.node_id === routeTarget) return true;
      if (blockedSet.has(n.node_id)) return true;
      if (filterRole === 'sag') return n.depth_cm >= 10 || n.role === 'sag' || n.name.toLowerCase().includes('underpass');
      if (filterRole === 'hospital') return n.role === 'hospital';
      
      // Only render nodes on screen that have actual water risk (depth >= 10 cm)
      return n.depth_cm >= 10;
    });
  }, [nodes, routeSource, routeTarget, blockedSet, filterRole]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* ─── Auto Emergency Simulation Live Mission Tracker Banner ─── */}
      {isAutoSim && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(30, 27, 75, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1.5px solid #6366f1',
            borderRadius: 14,
            padding: '12px 18px',
            boxShadow: '0 10px 40px rgba(99, 102, 241, 0.5), 0 0 20px rgba(0, 0, 0, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxWidth: '92%',
            minWidth: 360,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, animation: 'pulse 1s infinite' }}>🚨</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#f8fafc', letterSpacing: '0.4px' }}>
                  LIVE EMERGENCY TRANSIT TO AIIMS APEX TRAUMA
                </div>
                <div style={{ fontSize: 10.5, color: '#a5b4fc', fontWeight: 600 }}>
                  Automated Multi-Phase Solver • Step {autoSimStep} of 5
                </div>
              </div>
            </div>

            {onStopAutoSim && (
              <button
                type="button"
                onClick={onStopAutoSim}
                style={{
                  background: 'rgba(239, 68, 68, 0.25)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  borderRadius: 6,
                  color: '#fca5a5',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>⏹️</span>
                <span>End Simulation</span>
              </button>
            )}
          </div>

          {/* Step Progress Indicators */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[
              { num: 1, label: '⛈️ Storm Ingress' },
              { num: 2, label: '🚨 SOS Alert' },
              { num: 3, label: '🧠 AI Safe Detour' },
              { num: 4, label: '🚑 In Transit' },
              { num: 5, label: '🏥 Patient Delivered' },
            ].map(s => {
              const isActive = autoSimStep === s.num;
              const isPast = autoSimStep > s.num;
              return (
                <div
                  key={s.num}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '3px 4px',
                    borderRadius: 5,
                    fontSize: 9.5,
                    fontWeight: isActive ? 800 : 600,
                    background: isActive
                      ? 'rgba(99, 102, 241, 0.4)'
                      : isPast
                      ? 'rgba(16, 185, 129, 0.25)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: isActive
                      ? '1px solid #818cf8'
                      : isPast
                      ? '1px solid rgba(16, 185, 129, 0.4)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    color: isActive ? '#ffffff' : isPast ? '#6ee7b7' : '#94a3b8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.label}
                </div>
              );
            })}
          </div>

          {/* Current Step Description Message */}
          <div
            style={{
              fontSize: 11,
              color: '#e2e8f0',
              lineHeight: 1.4,
              background: 'rgba(0, 0, 0, 0.35)',
              padding: '6px 10px',
              borderRadius: 6,
              borderLeft: '3px solid #6366f1',
            }}
          >
            {autoSimMessage}
          </div>

          {/* User Handover Hint */}
          <div style={{ fontSize: 9.5, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>💡 Click any destination dropdown or map node anytime to take over</span>
            {simAmbulanceCoord && (
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                Progress: {simAmbulanceCoord.progress.toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* ─── Floating Top HUD: Interactive Route & Node Selection ─── */}
      <div
        style={{
          position: 'absolute',
          top: isAutoSim ? 150 : 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 12,
          padding: '10px 16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxWidth: '92%',
          minWidth: 320,
          pointerEvents: 'auto',
          transition: 'top 0.3s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>🚑</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#f8fafc', letterSpacing: '0.3px' }}>
              Ambulance Route Planner
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {onSwapRoute && (
              <button
                type="button"
                onClick={onSwapRoute}
                title="Swap Start and Destination"
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  color: '#38bdf8',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>⇄</span>
                <span>Swap</span>
              </button>
            )}

            {onClearRoute && (
              <button
                type="button"
                onClick={onClearRoute}
                title="Clear Selected Route"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 6,
                  color: '#fca5a5',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                ✕ Reset
              </button>
            )}

            {/* Collapse / Expand Top HUD Box */}
            <button
              type="button"
              onClick={() => setIsHudCollapsed(prev => !prev)}
              title={isHudCollapsed ? "Expand Route Planner Panel" : "Collapse Box for Full Map View"}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 6,
                color: '#cbd5e1',
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{isHudCollapsed ? '▼ Expand' : '▲ Collapse Box'}</span>
            </button>
          </div>
        </div>

        {!isHudCollapsed && (
          <>

        {/* Selected Locations Banner with Direct Interactive Dropdown Selectors */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
          {/* Origin Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              padding: '3px 6px',
              borderRadius: 6,
              color: '#34d399',
              fontWeight: 600,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>Origin:</span>
            <select
              value={routeSource || ''}
              onChange={(e) => onSelectOrigin && onSelectOrigin(e.target.value)}
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: 4,
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                outline: 'none',
                maxWidth: 240,
                padding: '2px 4px',
              }}
            >
              <optgroup label="⭐ Dispatch Starting Locations & Hubs">
                {TOP_15_DESTINATIONS.map((d: any) => {
                  const dDepth = nodeDepthMap.get(d.id) ?? 0;
                  const isSafe = dDepth <= 15;
                  return (
                    <option key={d.id} value={d.id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                      {d.icon} {d.name} ({isSafe ? '🟢 Passable' : '🚨 Inundated'} - {dDepth.toFixed(1)}cm)
                    </option>
                  );
                })}
              </optgroup>
              <optgroup label="📍 Primary Landmark Corridors & Intersections">
                {dropdownLandmarkNodes.map(n => (
                  <option key={n.node_id} value={n.node_id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div style={{ color: '#475569' }}>➔</div>

          {/* Destination Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              padding: '3px 6px',
              borderRadius: 6,
              color: '#a5b4fc',
              fontWeight: 600,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#c7d2fe' }}>Destination:</span>
            <select
              value={routeTarget || ''}
              onChange={(e) => onSelectTarget && onSelectTarget(e.target.value)}
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: 4,
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                outline: 'none',
                maxWidth: 240,
                padding: '2px 4px',
              }}
            >
              <optgroup label="⭐ Top 15 Emergency Hospital & Trauma Hubs (Fast O(1) Cache)">
                {TOP_15_DESTINATIONS.map((d: any) => {
                  const dDepth = nodeDepthMap.get(d.id) ?? 0;
                  const isSafe = dDepth <= 15;
                  return (
                    <option key={d.id} value={d.id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                      {d.icon} {d.name} ({isSafe ? '🟢 Passable' : '🚨 Inundated'} - {dDepth.toFixed(1)}cm)
                    </option>
                  );
                })}
              </optgroup>
              <optgroup label="📍 Primary Landmark Corridors & Intersections">
                {dropdownLandmarkNodes.map(n => (
                  <option key={n.node_id} value={n.node_id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <span
              style={{
                fontSize: 9,
                padding: '2px 5px',
                borderRadius: 4,
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                fontWeight: 700,
                border: '1px solid rgba(56, 189, 248, 0.3)',
                whiteSpace: 'nowrap',
              }}
              title="Pre-cached in-memory lookups run in O(1) <1ms"
            >
              ⚡ O(1) Cached
            </span>
          </div>
        </div>

        {/* Distance, Risk Status & Interactive Choke Simulator Button */}
        {showRoute && routeResult && (
          <div
            style={{
              marginTop: 2,
              padding: '6px 10px',
              borderRadius: 6,
              background: routeResult.reachable
                ? 'rgba(16, 185, 129, 0.12)'
                : 'rgba(239, 68, 68, 0.18)',
              border: `1px solid ${routeResult.reachable ? 'rgba(16, 185, 129, 0.3)' : '#ef4444'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: 11,
              flexWrap: 'wrap',
            }}
          >
            {routeResult.reachable ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#34d399', fontWeight: 700 }}>
                  <span>🟢 Safest Distance:</span>
                  <span style={{ color: '#ffffff', fontWeight: 800 }}>{routeResult.distance_m} m</span>
                  <span style={{ color: '#94a3b8', fontSize: 10 }}>
                    (~{Math.ceil(routeResult.eta_safe_sec)}s at 30km/h)
                  </span>
                </div>

                {routeResult.is_rerouted && (
                  <div style={{ color: '#f59e0b', fontSize: 10, fontWeight: 600 }}>
                    ⚠️ Bypassed {routeResult.normal_distance_m}m direct path ({routeResult.normal_max_depth_cm}cm water)
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#fca5a5', fontWeight: 700 }}>
                ⛔ {routeResult.message}
              </div>
            )}

            {/* Prominent Choke Simulation Button (Appears when route is active) */}
            <button
              type="button"
              onClick={() => setShowChokeModal(prev => !prev)}
              style={{
                background: blockedNodes.length > 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.25)',
                border: `1px solid ${blockedNodes.length > 0 ? '#ef4444' : '#f59e0b'}`,
                borderRadius: 6,
                color: blockedNodes.length > 0 ? '#fca5a5' : '#fef08a',
                fontSize: 10.5,
                fontWeight: 800,
                padding: '3px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                marginLeft: 'auto',
                boxShadow: blockedNodes.length > 0 ? '0 0 10px rgba(239, 68, 68, 0.4)' : undefined,
              }}
              title="Select which manholes/potholes are choked to simulate localized backwater surcharging"
            >
              <span>🚧</span>
              <span>Choke Potholes / Drains</span>
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: blockedNodes.length > 0 ? '#dc2626' : 'rgba(0,0,0,0.4)',
                  color: '#ffffff',
                  fontWeight: 800,
                }}
              >
                {blockedNodes.length > 0 ? `${blockedNodes.length} Clogged` : 'Test Impact'}
              </span>
            </button>
          </div>
        )}

        {/* Filter Pills & Hazard Layer Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>Filter:</span>
          {[
            { id: 'all', label: `Clean View` },
            { id: 'hospital', label: `🏥 Hospitals` },
            { id: 'sag', label: `🌊 Inundated Sags` },
          ].map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterRole(f.id)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '3px 7px',
                borderRadius: 12,
                cursor: 'pointer',
                border: filterRole === f.id ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.12)',
                background: filterRole === f.id ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.05)',
                color: filterRole === f.id ? '#38bdf8' : '#cbd5e1',
              }}
            >
              {f.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setShowPotholes(prev => !prev)}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 12,
              cursor: 'pointer',
              border: showPotholes ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.15)',
              background: showPotholes ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.05)',
              color: showPotholes ? '#fbbf24' : '#94a3b8',
              marginLeft: 'auto',
            }}
          >
            🕳️ Potholes ({potholes.length}) {showPotholes ? 'ON' : 'OFF'}
          </button>

          {isSafeRouteActive && (
            <button
              type="button"
              onClick={() => setShowNodesWhenRouting(prev => !prev)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 12,
                cursor: 'pointer',
                border: showNodesWhenRouting ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
                background: showNodesWhenRouting ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.06)',
                color: showNodesWhenRouting ? '#34d399' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Toggle junction nodes visibility while viewing the safe route"
            >
              <span>{showNodesWhenRouting ? '👁️ Nodes: Visible' : '👁️‍🗨️ Nodes: Hidden'}</span>
            </button>
          )}
        </div>
      </>
    )}
  </div>

      {/* ─── Interactive Pothole / Manhole Choke Simulator Drawer ─── */}
      {showChokeModal && (
        <div
          style={{
            position: 'absolute',
            top: isAutoSim ? 190 : 150,
            right: 14,
            zIndex: 1100,
            width: 320,
            maxHeight: '70vh',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1.5px solid rgba(239, 68, 68, 0.5)',
            borderRadius: 12,
            boxShadow: '0 10px 35px rgba(0, 0, 0, 0.8), 0 0 20px rgba(239, 68, 68, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '10px 14px',
              background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.25) 0%, rgba(15, 23, 42, 0.4) 100%)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>🚧</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#fca5a5' }}>
                  Drain Choke & Surcharge Sim
                </div>
                <div style={{ fontSize: 9, color: '#94a3b8' }}>
                  Select blocked potholes to surcharge local roads
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowChokeModal(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              ✕
            </button>
          </div>

          {/* Search Box */}
          <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <input
              type="text"
              placeholder="🔍 Search road / pothole name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                fontSize: 11,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Quick Scenario Preset Buttons */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 9.5, color: '#38bdf8', fontWeight: 700 }}>⚡ 1-Click Choke Presets:</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  toggleChoke('minto_bridge_center');
                }}
                style={{
                  fontSize: 9.5,
                  padding: '4px 7px',
                  borderRadius: 5,
                  background: blockedNodes.includes('minto_bridge_center') ? '#dc2626' : 'rgba(239, 68, 68, 0.2)',
                  color: '#ffffff',
                  border: '1px solid #ef4444',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                🚨 Minto Sump (+65cm)
              </button>

              <button
                type="button"
                onClick={() => {
                  const cpNodes = ['cp_outer_s', 'ddu_marg_west', 'barakhamba_radial'];
                  cpNodes.forEach(nid => {
                    toggleChoke(nid);
                  });
                }}
                style={{
                  fontSize: 9.5,
                  padding: '4px 7px',
                  borderRadius: 5,
                  background: 'rgba(245, 158, 11, 0.2)',
                  color: '#fbbf24',
                  border: '1px solid #f59e0b',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                🚨 CP Radials (+30cm)
              </button>

              <button
                type="button"
                onClick={() => {
                  toggleChoke('barakhamba_junction');
                }}
                style={{
                  fontSize: 9.5,
                  padding: '4px 7px',
                  borderRadius: 5,
                  background: blockedNodes.includes('barakhamba_junction') ? '#dc2626' : 'rgba(239, 68, 68, 0.2)',
                  color: '#ffffff',
                  border: '1px solid #ef4444',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                🚨 Barakhamba
              </button>

              {blockedNodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (onClearBlockedNodes) onClearBlockedNodes();
                    else blockedNodes.forEach(nid => toggleChoke(nid));
                  }}
                  style={{
                    fontSize: 9.5,
                    padding: '4px 8px',
                    borderRadius: 5,
                    background: 'rgba(16, 185, 129, 0.25)',
                    color: '#34d399',
                    border: '1px solid #10b981',
                    cursor: 'pointer',
                    fontWeight: 800,
                    marginLeft: 'auto',
                  }}
                >
                  🔄 Reset All ({blockedNodes.length})
                </button>
              )}
            </div>
          </div>

          {/* Direction Filter Tabs (North, NE, East, SE, South, SW, West, NW of Rajiv Chowk) */}
          <div style={{ padding: '6px 12px', display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            {[
              { id: 'all', label: 'All (65)' },
              { id: 'north', label: 'North' },
              { id: 'northeast', label: 'NE/Minto' },
              { id: 'east', label: 'East' },
              { id: 'southeast', label: 'SE/ITO' },
              { id: 'south', label: 'South' },
              { id: 'southwest', label: 'SW' },
              { id: 'west', label: 'West' },
              { id: 'northwest', label: 'NW' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setChokeDirection(tab.id)}
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  border: chokeDirection === tab.id ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  background: chokeDirection === tab.id ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: chokeDirection === tab.id ? '#38bdf8' : '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Pothole / Manhole List */}
          <div style={{ padding: '8px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            {potholes
              .filter(ph => {
                if (searchQuery.trim()) {
                  const q = searchQuery.toLowerCase();
                  return ph.name.toLowerCase().includes(q) || ph.road.toLowerCase().includes(q);
                }
                if (chokeDirection === 'all') return true;
                const dLat = ph.lat - 28.6328;
                const dLon = ph.lon - 77.2197;
                const angle = (Math.atan2(dLat, dLon) * 180) / Math.PI;
                if (chokeDirection === 'north') return angle >= 67.5 && angle < 112.5;
                if (chokeDirection === 'northeast') return angle >= 22.5 && angle < 67.5;
                if (chokeDirection === 'east') return angle >= -22.5 && angle < 22.5;
                if (chokeDirection === 'southeast') return angle >= -67.5 && angle < -22.5;
                if (chokeDirection === 'south') return angle >= -112.5 && angle < -67.5;
                if (chokeDirection === 'southwest') return angle >= -157.5 && angle < -112.5;
                if (chokeDirection === 'northwest') return angle >= 112.5 && angle < 157.5;
                return angle < -157.5 || angle >= 157.5; // west
              })
              .map(ph => {
                const mappedNodeId = potholeNodeMap.get(ph.id) || ph.id;
                const isBlocked = blockedSet.has(mappedNodeId);
                const localDepth = nodeDepthMap.get(mappedNodeId) ?? ph.depth_cm;

                return (
                  <div
                    key={ph.id}
                    onClick={() => toggleChoke(mappedNodeId)}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      background: isBlocked ? 'rgba(239, 68, 68, 0.25)' : 'rgba(30, 41, 59, 0.6)',
                      border: `1.5px solid ${isBlocked ? '#ef4444' : 'rgba(255, 255, 255, 0.08)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14 }}>{isBlocked ? '🚫' : '🕳️'}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: isBlocked ? '#fca5a5' : '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ph.name}
                        </div>
                        <div style={{ fontSize: 9, color: '#94a3b8' }}>
                          {ph.road} · {localDepth.toFixed(1)}cm water
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleChoke(mappedNodeId);
                      }}
                      style={{
                        fontSize: 9.5,
                        fontWeight: 900,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: isBlocked ? '#dc2626' : 'rgba(16, 185, 129, 0.2)',
                        color: isBlocked ? '#ffffff' : '#34d399',
                        border: `1px solid ${isBlocked ? '#ef4444' : 'rgba(16, 185, 129, 0.4)'}`,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      {isBlocked ? 'CLOGGED ✕' : 'CLOG +'}
                    </button>
                  </div>
                );
              })}
          </div>

          {/* Footer status */}
          <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.4)', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 9.5, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
            <span>⚡ {blockedNodes.length} manholes active</span>
            <span style={{ color: '#34d399' }}>AI Dynamic Rerouting ON</span>
          </div>
        </div>
      )}

      {/* ─── Bottom Floating Emergency Modal: NO SAFE ROUTE AVAILABLE ─── */}
      {showRoute && routeResult && !routeResult.reachable && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: 'linear-gradient(135deg, rgba(127, 29, 29, 0.96) 0%, rgba(153, 27, 27, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '2px solid #ef4444',
            borderRadius: 14,
            padding: '14px 20px',
            boxShadow: '0 12px 40px rgba(239, 68, 68, 0.6), 0 0 25px rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            maxWidth: '92%',
            minWidth: 380,
            pointerEvents: 'auto',
          }}
        >
          <span style={{ fontSize: 26, flexShrink: 0 }}>🚨</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: '#fef08a', letterSpacing: '0.4px', textTransform: 'uppercase' }}>
              NO SAFE AMBULANCE ROUTE AVAILABLE!
            </div>
            <div style={{ fontSize: 11, color: '#fecaca', marginTop: 2, lineHeight: 1.4 }}>
              {routeResult.message}
            </div>
          </div>
          {onClearBlockedNodes && blockedNodes.length > 0 && (
            <button
              type="button"
              onClick={onClearBlockedNodes}
              style={{
                background: '#ffffff',
                color: '#b91c1c',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 11,
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>🔄</span>
              <span>Unclog Drains</span>
            </button>
          )}
        </div>
      )}

      {/* ─── Case 1: Chokes Active, but Current Route is Still Safe (No Breach) ─── */}
      {showRoute && routeResult && routeResult.reachable && !routeResult.is_rerouted && blockedNodes.length > 0 && !dismissedBottomModal && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1.5px solid #10b981',
            borderRadius: 12,
            padding: '10px 16px',
            boxShadow: '0 8px 30px rgba(16, 185, 129, 0.3), 0 0 20px rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: '90%',
            pointerEvents: 'auto',
          }}
        >
          <span style={{ fontSize: 20 }}>🟢</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#6ee7b7' }}>
              ORIGINAL ROUTE STILL SAFE ({blockedNodes.length} Drain{blockedNodes.length > 1 ? 's' : ''} Choked Elsewhere)
            </div>
            <div style={{ fontSize: 10.5, color: '#cbd5e1' }}>
              Current corridor unaffected by backwater surcharge (Peak Water on Route: {(routeResult.safe_max_depth_cm ?? 0).toFixed(1)}cm &le; 15cm). No reroute needed.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedBottomModal(true)}
            title="Dismiss notification box"
            style={{ background: 'transparent', border: 'none', color: '#6ee7b7', fontSize: 14, cursor: 'pointer', marginLeft: 'auto', padding: '0 4px', fontWeight: 800 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ─── Case 2: Route Breached -> 2nd Safest Bypass Route Recommended ─── */}
      {showRoute && routeResult && routeResult.reachable && routeResult.is_rerouted && blockedNodes.length > 0 && !dismissedBottomModal && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: 'linear-gradient(135deg, rgba(120, 53, 15, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1.5px solid #f59e0b',
            borderRadius: 12,
            padding: '10px 16px',
            boxShadow: '0 8px 30px rgba(245, 158, 11, 0.4), 0 0 20px rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: '90%',
            pointerEvents: 'auto',
          }}
        >
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fef08a' }}>
              PREVIOUS ROUTE BREACHED ➔ 2ND SAFEST BYPASS RECOMMENDED
            </div>
            <div style={{ fontSize: 10.5, color: '#fde68a' }}>
              Clogged drains submerged direct path ({routeResult.normal_max_depth_cm ? `${routeResult.normal_max_depth_cm.toFixed(1)}cm` : '>15cm'} water). Agastya AI recommended 2nd safest bypass ({routeResult.distance_m}m, Max Water: {(routeResult.safe_max_depth_cm ?? 0).toFixed(1)}cm &le; 15cm).
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedBottomModal(true)}
            title="Dismiss notification box"
            style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: 14, cursor: 'pointer', marginLeft: 'auto', padding: '0 4px', fontWeight: 800 }}
          >
            ✕
          </button>
        </div>
      )}

      <MapContainer
        center={center}
        zoom={zoom}
        className="leaflet-container"
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
      >
        {/* Dynamic tile layer based on selected tileLayer state */}
        <TileLayer
          key={tileLayer}
          attribution={TILE_ATTRS[tileLayer]}
          url={TILE_URLS[tileLayer]}
          maxZoom={19}
          opacity={tileLayer === 'satellite' ? 0.85 : 1}
        />
        {tileLayer === 'dark' && !cartoKey && (
          <TileLayer
            key="dark-ref-labels"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
            maxZoom={18}
            opacity={0.75}
          />
        )}

        <MapUpdater center={center} zoom={zoom} routePath={routePath} />
        <ZoomTracker onZoomChange={setCurrentZoom} />

        {/* Pipe network lines (Dimmed during safe route active mode) — Single SVG path for 60 FPS performance */}
        {!isSafeRouteActive && multiPolylinePositions.length > 0 && (
          <Polyline
            positions={multiPolylinePositions}
            pathOptions={{
              color: 'rgba(59, 130, 246, 0.25)',
              weight: 1.5,
              dashArray: '4 4',
            }}
          />
        )}

        {/* ─── Alternate Route(s) with Predicted Water Level (Glowing Red Line Trace) ─── */}
        {showRoute && routeResult?.alternate_routes && routeResult.alternate_routes.map((alt, idx) => {
          if (!alt.path_coords || alt.path_coords.length < 2) return null;
          const midIdx = Math.floor(alt.path_coords.length / 2);
          const midPt = alt.path_coords[midIdx];
          const isFlooded = alt.max_depth_cm > 15;

          return (
            <Fragment key={alt.id || idx}>
              {/* Glowing Red Polyline Trace */}
              <Polyline
                positions={alt.path_coords.map(p => [p.lat, p.lon] as [number, number])}
                pathOptions={{
                  color: '#ef4444',
                  weight: 5,
                  opacity: 0.85,
                  dashArray: '8 6',
                }}
              />

              {/* Midpoint Warning Callout Badge on the Alternate Red Path */}
              {midPt && (
                <CircleMarker
                  center={[midPt.lat, midPt.lon]}
                  radius={10}
                  pathOptions={{
                    color: '#ffffff',
                    fillColor: '#ef4444',
                    fillOpacity: 1,
                    weight: 2.5,
                  }}
                >
                  <Tooltip permanent direction="top" offset={[0, -10]}>
                    <div style={{ fontWeight: 800, fontSize: 10.5, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>🚨 {alt.name}</span>
                      <span style={{ color: '#dc2626', fontWeight: 900 }}>[{alt.max_depth_cm.toFixed(1)}cm Water]</span>
                    </div>
                  </Tooltip>
                  <Popup>
                    <div className="popup-content" style={{ minWidth: 230 }}>
                      <div className="popup-title" style={{ color: '#ef4444' }}>
                        🚨 Alternate Path (Rejected by AI)
                      </div>
                      <div className="popup-stat">
                        <span>Route Name</span>
                        <span className="popup-stat-value">{alt.name}</span>
                      </div>
                      <div className="popup-stat">
                        <span>Predicted Peak Water</span>
                        <span className="popup-stat-value" style={{ color: '#ef4444', fontWeight: 800 }}>
                          {alt.max_depth_cm.toFixed(1)} cm ({isFlooded ? 'UNSAFE SUBMERGED' : 'PASSABLE'})
                        </span>
                      </div>
                      <div className="popup-stat">
                        <span>Average Road Depth</span>
                        <span className="popup-stat-value">{alt.avg_depth_cm.toFixed(1)} cm</span>
                      </div>
                      <div className="popup-stat">
                        <span>Total Distance</span>
                        <span className="popup-stat-value">{alt.distance_m} m</span>
                      </div>
                      <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', fontSize: 10.5 }}>
                        <strong>AI Model Decision:</strong> {alt.reason_rejected}
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              )}
            </Fragment>
          );
        })}

        {/* Safe ambulance route — Glowing Emerald Line with animated ant-march */}
        {showRoute && routePath.length > 1 && (
          <>
            {/* Glow backing with interactive click-to-choke path */}
            <Polyline
              positions={routePath.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{
                color: '#10b981',
                weight: 16,
                opacity: 0.25,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent?.stopPropagation();
                  if (onChokeActiveRoute) onChokeActiveRoute();
                },
              }}
            >
              <Tooltip sticky direction="top">
                <span style={{ fontWeight: 700, color: '#0f172a' }}>🚧 Click road path to choke corridor & trigger dynamic safe reroute</span>
              </Tooltip>
            </Polyline>

            {/* Solid core */}
            <Polyline
              positions={routePath.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{
                color: '#10b981',
                weight: 6,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
                className: 'route-ant-march cursor-pointer',
              }}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent?.stopPropagation();
                  if (onChokeActiveRoute) onChokeActiveRoute();
                },
              }}
            />

            {/* Route START Marker (Origin) — Emerald Green */}
            <CircleMarker
              center={[routePath[0].lat, routePath[0].lon]}
              radius={12}
              pathOptions={{
                color: '#ffffff',
                fillColor: '#10b981',
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -12]} className="route-tooltip-start">
                🚑 START: {routePath[0].name}
              </Tooltip>
            </CircleMarker>

            {/* Route END Marker (Destination) — Royal Indigo */}
            <CircleMarker
              center={[routePath[routePath.length - 1].lat, routePath[routePath.length - 1].lon]}
              radius={12}
              pathOptions={{
                color: '#ffffff',
                fillColor: '#6366f1',
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -12]} className="route-tooltip-end">
                🏥 DESTINATION: {routePath[routePath.length - 1].name}
              </Tooltip>
            </CircleMarker>

            {/* Live Animated Ambulance Marker with Siren Pulse */}
            {simAmbulanceCoord && (
              <>
                {/* Outer Flashing Siren Ring */}
                <CircleMarker
                  center={[simAmbulanceCoord.lat, simAmbulanceCoord.lon]}
                  radius={20}
                  pathOptions={{
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.35,
                    weight: 2,
                    dashArray: '3 3',
                  }}
                />
                {/* Inner Ambulance Beacon */}
                <CircleMarker
                  center={[simAmbulanceCoord.lat, simAmbulanceCoord.lon]}
                  radius={13}
                  pathOptions={{
                    color: '#ffffff',
                    fillColor: '#dc2626',
                    fillOpacity: 1,
                    weight: 3,
                  }}
                >
                  <Tooltip permanent direction="top" offset={[0, -14]}>
                    <div style={{ fontWeight: 800, fontSize: 11, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>🚑 AMBULANCE (DL-1R-9988)</span>
                      <span style={{ fontSize: 9, color: '#dc2626' }}>[SIREN ON]</span>
                    </div>
                  </Tooltip>
                </CircleMarker>
              </>
            )}
          </>
        )}

        {/* Pothole Hazard Markers Layer with Interactive Click-to-Choke — hidden when safest path is active */}
        {showPotholes && (!isSafeRouteActive || showNodesWhenRouting) && potholes.map((ph) => {
          const isSevere = ph.severity === 'SEVERE';
          const mappedNodeId = potholeNodeMap.get(ph.id) || ph.id;
          const isChoked = blockedSet.has(mappedNodeId);

          return (
            <CircleMarker
              key={ph.id}
              center={[ph.lat, ph.lon]}
              radius={isChoked ? 11 : isSevere ? 9 : 7}
              pathOptions={{
                color: isChoked ? '#dc2626' : '#ffffff',
                fillColor: isChoked ? '#ef4444' : isSevere ? '#ef4444' : '#f59e0b',
                fillOpacity: isChoked ? 1 : 0.9,
                weight: isChoked ? 3 : 2,
                dashArray: isChoked ? '3 3' : undefined,
              }}
              eventHandlers={{
                click: () => toggleChoke(mappedNodeId),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                {isChoked ? `🚫 [CLOGGED] ${ph.name}` : `🕳️ ${ph.name} (${ph.depth_cm}cm)`}
              </Tooltip>
              <Popup>
                <div className="popup-content" style={{ minWidth: 220 }}>
                  <div className="popup-title" style={{ color: isChoked ? '#ef4444' : isSevere ? '#ef4444' : '#f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{isChoked ? `🚫 [CHOKED] ${ph.name}` : `🕳️ ${ph.name}`}</span>
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: isChoked ? '#dc2626' : 'rgba(16,185,129,0.2)', color: '#ffffff' }}>
                      {isChoked ? 'SURCHARGING' : 'OPEN'}
                    </span>
                  </div>
                  <div className="popup-stat">
                    <span>Road</span>
                    <span className="popup-stat-value">{ph.road}</span>
                  </div>
                  <div className="popup-stat">
                    <span>Severity</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: isSevere ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: isSevere ? '#f87171' : '#fbbf24',
                        border: `1px solid ${isSevere ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
                      }}
                    >
                      {ph.severity} HAZARD
                    </span>
                  </div>
                  <div className="popup-stat">
                    <span>Pit / Surcharge Depth</span>
                    <span className="popup-stat-value" style={{ color: isSevere ? '#ef4444' : '#f59e0b', fontWeight: 800 }}>
                      {(nodeDepthMap.get(mappedNodeId) ?? ph.depth_cm).toFixed(1)} cm
                    </span>
                  </div>
                  <div className="popup-stat">
                    <span>Coordinates</span>
                    <span className="popup-stat-value">{ph.lat.toFixed(4)}°N, {ph.lon.toFixed(4)}°E</span>
                  </div>

                  {/* 1-Click Choke Toggle Button */}
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleChoke(mappedNodeId);
                      }}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: 10.5,
                        fontWeight: 800,
                        background: isChoked ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: isChoked ? '#34d399' : '#fca5a5',
                        border: `1px solid ${isChoked ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      {isChoked ? '🟢 Unclog Drain Inlet' : '🚨 Clog / Choke this Drain'}
                    </button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Flood depth markers + blocked halos — invisible when safest path is active unless toggled */}
        {(!isSafeRouteActive || showNodesWhenRouting
          ? filteredNodes
          : filteredNodes.filter(node => blockedSet.has(node.node_id))
        ).map((node) => {
          const isBlocked = blockedSet.has(node.node_id);
          const isSource = node.node_id === routeSource;
          const isTarget = node.node_id === routeTarget;
          const isEndpoint = isSource || isTarget;
          const isWaypoint = node.node_id.includes('_wp');
          const radius = getDepthRadius(node.depth_cm, isWaypoint);

          return (
            <Fragment key={node.node_id}>
              {/* Outer halo ring for blocked nodes */}
              {isBlocked && (
                <CircleMarker
                  center={[node.lat, node.lon]}
                  radius={radius + 11}
                  pathOptions={{
                    color: '#dc2626',
                    fillColor: '#ef4444',
                    fillOpacity: 0.15,
                    weight: 2.5,
                    dashArray: '5 4',
                    opacity: 0.8,
                    interactive: false,
                  }}
                />
              )}

              {/* Inner halo ring for blocked nodes */}
              {isBlocked && (
                <CircleMarker
                  center={[node.lat, node.lon]}
                  radius={radius + 6}
                  pathOptions={{
                    color: '#ef4444',
                    fillColor: '#dc2626',
                    fillOpacity: 0.1,
                    weight: 1.5,
                    dashArray: '3 3',
                    opacity: 0.6,
                    interactive: false,
                  }}
                />
              )}

              {/* Distinct indicator ring for routing endpoints */}
              {isEndpoint && (
                <CircleMarker
                  center={[node.lat, node.lon]}
                  radius={radius + 6}
                  pathOptions={{
                    color: isSource ? '#10b981' : '#6366f1',
                    fillOpacity: 0,
                    weight: 3,
                    dashArray: '2 2',
                    interactive: false,
                  }}
                />
              )}

              {/* Main node marker */}
              <CircleMarker
                center={[node.lat, node.lon]}
                radius={isBlocked ? radius + 3 : radius}
                pathOptions={{
                  color: isBlocked ? '#ffffff' : isEndpoint ? (isSource ? '#10b981' : '#6366f1') : getDepthColor(node.depth_cm),
                  fillColor: isBlocked ? '#dc2626' : getDepthColor(node.depth_cm),
                  fillOpacity: isBlocked ? 0.95 : getDepthOpacity(node.depth_cm),
                  weight: isBlocked || isEndpoint ? 3 : 2,
                  opacity: 0.9,
                }}
                eventHandlers={{
                  click: () => onNodeClick(node.node_id),
                }}
              >
                <Tooltip direction="top" offset={[0, -radius]}>
                  <div style={{ fontWeight: 800, fontSize: 10.5, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{node.name}</span>
                    <span style={{ color: getDepthColor(node.depth_cm), fontWeight: 900 }}>
                      [{node.depth_cm.toFixed(1)}cm]
                    </span>
                  </div>
                </Tooltip>
                <Popup>
                  <div className="popup-content" style={{ minWidth: 220 }}>
                    <div className="popup-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span>{isBlocked ? `🚫 [BLOCKED] ${node.name}` : node.name}</span>
                      {isEndpoint && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: isSource ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)',
                            color: isSource ? '#34d399' : '#818cf8',
                            border: `1px solid ${isSource ? 'rgba(16,185,129,0.4)' : 'rgba(99,102,241,0.4)'}`,
                          }}
                        >
                          {isSource ? '🚑 START' : '🏥 DESTINATION'}
                        </span>
                      )}
                    </div>
                    <div className="popup-stat">
                      <span>Water Depth</span>
                      <span className="popup-stat-value" style={{ color: isBlocked ? '#ef4444' : undefined, fontWeight: 800 }}>
                        {node.depth_cm.toFixed(1)} cm
                      </span>
                    </div>
                    <div className="popup-stat">
                      <span>Flood Risk</span>
                      <span className={`popup-risk risk-${node.risk_level}`} style={{ fontWeight: 800 }}>
                        {node.risk_level}
                      </span>
                    </div>
                    <div className="popup-stat">
                      <span>Role / Type</span>
                      <span className="popup-stat-value" style={{ textTransform: 'capitalize' }}>
                        {node.role || 'Junction'}
                      </span>
                    </div>
                    <div className="popup-stat">
                      <span>Coordinates</span>
                      <span className="popup-stat-value">{node.lat.toFixed(4)}°N, {node.lon.toFixed(4)}°E</span>
                    </div>

                    {/* Quick 1-Click Action Buttons to Choose Start or Destination */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectOrigin) onSelectOrigin(node.node_id);
                        }}
                        style={{
                          flex: 1,
                          padding: '6px 4px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isSource ? '#10b981' : 'rgba(16, 185, 129, 0.2)',
                          color: isSource ? '#ffffff' : '#34d399',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          cursor: 'pointer',
                        }}
                      >
                        🟢 Set Start
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectTarget) onSelectTarget(node.node_id);
                        }}
                        style={{
                          flex: 1,
                          padding: '6px 4px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isTarget ? '#6366f1' : 'rgba(99, 102, 241, 0.2)',
                          color: isTarget ? '#ffffff' : '#a5b4fc',
                          border: '1px solid rgba(99, 102, 241, 0.4)',
                          cursor: 'pointer',
                        }}
                      >
                        🟣 Set Dest
                      </button>
                    </div>

                    {(chokeMode || isBlocked) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isEndpoint || isBlocked) {
                            toggleChoke(node.node_id);
                          }
                        }}
                        style={{
                          marginTop: 6,
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 10.5,
                          fontWeight: 800,
                          background: (isEndpoint && !isBlocked)
                            ? 'rgba(148, 163, 184, 0.15)'
                            : isBlocked
                            ? '#10b981'
                            : '#ef4444',
                          color: 'white',
                          textAlign: 'center',
                          cursor: (isEndpoint && !isBlocked) ? 'not-allowed' : 'pointer',
                          border: 'none',
                          boxShadow: isBlocked ? '0 0 10px rgba(16, 185, 129, 0.4)' : '0 0 10px rgba(239, 68, 68, 0.4)',
                        }}
                      >
                        {isBlocked
                          ? '🟢 Unblock Manhole'
                          : isEndpoint
                          ? '🛡️ Routing endpoint'
                          : '🔴 Block Manhole (Choke)'}
                      </button>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>

      {/* ─── Layer Switcher (top-right, below the AlertPanel zone) ─── */}
      <div className="layer-switcher" style={{ top: 14, right: 14 }}>
        <span style={{ fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 2 }}>🗺️</span>
        {(['dark', 'satellite', 'osm'] as const).map(layer => (
          <button
            key={layer}
            type="button"
            className={`layer-btn${tileLayer === layer ? ' active' : ''}`}
            onClick={() => setTileLayer(layer)}
            title={layer === 'dark' ? 'CartoDB Dark' : layer === 'satellite' ? 'Satellite Imagery' : 'OpenStreetMap'}
          >
            {layer === 'dark' ? '🌑 Dark' : layer === 'satellite' ? '🛰️ Sat' : '🗺️ OSM'}
          </button>
        ))}
      </div>

      {/* ─── Mini Overview Map (bottom-right inset) ─── */}
      <div
        className="mini-overview-map"
        title="Overview map — click to re-center main map"
        style={{ bottom: 36, right: 12 }}
      >
        <MapContainer
          center={[28.6280, 77.2197]}
          zoom={10}
          style={{ width: '100%', height: '100%' }}
          dragging={false}
          zoomControl={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          attributionControl={false}
        >
          <TileLayer
            url={TILE_URLS.dark}
            maxZoom={12}
            attribution=""
          />
          {/* Show only critical + high nodes in mini map */}
          {nodes
            .filter(n => n.depth_cm >= 20 && !n.node_id.startsWith('mesh_'))
            .slice(0, 60)
            .map(n => (
              <CircleMarker
                key={`mini-${n.node_id}`}
                center={[n.lat, n.lon]}
                radius={3}
                pathOptions={{
                  fillColor: getDepthColor(n.depth_cm),
                  fillOpacity: 0.85,
                  color: 'transparent',
                  weight: 0,
                }}
              />
            ))}
        </MapContainer>
        <div style={{
          position: 'absolute',
          top: 4,
          left: 6,
          fontSize: 8,
          fontWeight: 800,
          color: 'rgba(255,255,255,0.5)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}>
          Overview
        </div>
      </div>

      {/* ─── Right-Center Floating Choke Control Panel ─── */}
      {showRoute && (
        <div
          className="choke-floating-hud"
          style={{
            position: 'fixed',
            right: '16px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '8px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Status Info Badge */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.92)',
              backdropFilter: 'blur(8px)',
              border: routeResult?.reachable ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(239, 68, 68, 0.8)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: '#e2e8f0',
              fontSize: '11px',
              fontWeight: 700,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              maxWidth: '220px',
            }}
          >
            <span style={{ fontSize: '14px' }}>
              {routeResult?.reachable ? '🚑' : '🚨'}
            </span>
            <span>
              {routeResult?.reachable
                ? `Route: ${routeResult.distance_m}m ${blockedNodes.length > 0 ? `(${blockedNodes.length} Choked)` : ''}`
                : '⛔ No Safe Alternative Route'}
            </span>
          </div>

          {/* Primary Choke Button */}
          <button
            type="button"
            onClick={() => {
              if (onChokeActiveRoute) onChokeActiveRoute();
            }}
            title="Choke key road segment on current route and calculate next safe alternative route"
            style={{
              background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '10px',
              padding: '10px 16px',
              fontSize: '12.5px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 0 20px rgba(239, 68, 68, 0.6), 0 4px 12px rgba(0,0,0,0.4)',
              transition: 'all 0.2s ease',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            }}
          >
            <span style={{ fontSize: '15px', filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' }}>⚡</span>
            <span>Choke Active Route</span>
          </button>

          {/* Clear Chokes Reset Button */}
          {blockedNodes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (onClearBlockedNodes) onClearBlockedNodes();
              }}
              title="Clear all choked nodes and restore baseline route"
              style={{
                background: 'rgba(30, 41, 59, 0.9)',
                color: '#34d399',
                border: '1px solid rgba(52, 211, 153, 0.4)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backdropFilter: 'blur(4px)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
              }}
            >
              <span>↺ Clear Chokes ({blockedNodes.length})</span>
            </button>
          )}
        </div>
      )}

      {/* ─── Choke Pulse Rings (SVG overlay via CircleMarker) — rendered inside MapContainer above ─── */}
      {/* Note: choke rings are rendered as part of the Leaflet SVG layer within MapContainer */}
    </div>
  );
}
