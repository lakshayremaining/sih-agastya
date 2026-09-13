/**
 * Agastya — Urban Flood Nowcasting Platform
 * Minto Bridge, New Delhi — SIH 2026 (Problem 26085)
 * Main Dashboard Layout, Operational KPIs, Multi-Node Choke, and Safe Routing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import FloodMap from './components/FloodMap';
import AlertPanel from './components/AlertPanel';
import CalculationDrawer from './components/CalculationDrawer';
import { ToastContainer, useToasts } from './components/ToastNotifications';
import {
  simulate,
  findRoute,
  fetchLiveRain,
  fetchNetwork,
  getCachedSimulate,
  getCachedRoute,
  type NodeDepth,
  type FloodSummary,
  type RouteResponse,
  type NetworkEdge,
  type PathCoord,
  type RainResponse,
  type PotholeHazard,
} from './lib/api';
import {
  INITIAL_NODES,
  INITIAL_EDGES,
  CATCHMENT_NODES,
  POTHOLE_HAZARDS,
  simulateLocal,
  findRouteLocal,
  findOptimalSafeRoutePair,
} from './lib/networkData';

export default function App() {
  // ─── State ───────────────────────────────────────────────
  const [rainMm, setRainMm] = useState<number>(() => {
    const saved = localStorage.getItem('agastya_sim_rain_mm');
    return saved ? Number(saved) : 35;
  });
  const [minutes, setMinutes] = useState<number>(() => {
    const saved = localStorage.getItem('agastya_sim_minutes');
    return saved ? Number(saved) : 30;
  });
  const [blockedNodes, setBlockedNodes] = useState<string[]>([]);

  // Auto-save slider settings to localStorage
  useEffect(() => {
    localStorage.setItem('agastya_sim_rain_mm', String(rainMm));
  }, [rainMm]);

  useEffect(() => {
    localStorage.setItem('agastya_sim_minutes', String(minutes));
  }, [minutes]);

  const [nodes, setNodes] = useState<NodeDepth[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<NetworkEdge[]>(INITIAL_EDGES);
  const [potholes, setPotholes] = useState<PotholeHazard[]>(POTHOLE_HAZARDS);
  const [summary, setSummary] = useState<FloodSummary | null>(null);
  const [rainData, setRainData] = useState<RainResponse | null>(null);

  const [chokeMode, setChokeMode] = useState<boolean>(false);

  const [showRoute, setShowRoute] = useState<boolean>(true);
  const [routeSource, setRouteSource] = useState<string>('kashmere_gate_isbt');
  const [routeTarget, setRouteTarget] = useState<string>('cp_outer_n');
  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null);
  const [routePath, setRoutePath] = useState<PathCoord[]>([]);

  const [nodeList, setNodeList] = useState<{ id: string; name: string }[]>(() =>
    Object.entries(CATCHMENT_NODES).map(([id, info]) => ({
      id,
      name: info.name,
    }))
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([28.6139, 77.2090]);
  const [zoom, setZoom] = useState<number>(12);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState<boolean>(false);
  const { toasts, addToast, dismissToast } = useToasts();

  const debounceTimer = useRef<number | null>(null);
  const simAbortController = useRef<AbortController | null>(null);
  const routeAbortController = useRef<AbortController | null>(null);

  // ─── Auto Emergency Simulation State ─────────────────────
  const [isAutoSim, setIsAutoSim] = useState<boolean>(false);
  const [autoSimStep, setAutoSimStep] = useState<number>(0);
  const [autoSimMessage, setAutoSimMessage] = useState<string>('');
  const [simAmbulanceCoord, setSimAmbulanceCoord] = useState<{
    lat: number;
    lon: number;
    name?: string;
    progress: number;
  } | null>(null);
  const autoSimTimersRef = useRef<number[]>([]);

  // ─── Initial Network & Weather Load ───────────────────────
  useEffect(() => {
    async function initData() {
      setLoading(true);
      try {
        const net = await fetchNetwork();
        if (net && net.edges && net.edges.length > 0) {
          setEdges(net.edges);
          if (net.potholes && net.potholes.length > 0) {
            setPotholes(net.potholes);
          }
          if (net.center) {
            setMapCenter([net.center.lat, net.center.lon]);
          }
          if (net.zoom) {
            setZoom(net.zoom);
          }
          const list = Object.entries(net.nodes).map(([id, info]) => ({
            id,
            name: info.name || id,
          }));
          setNodeList(list);
          setIsLiveConnected(true);
        }
      } catch (err) {
        console.warn('Network fetch using cached topology:', err);
      }

      try {
        const rain = await fetchLiveRain();
        setRainData(rain);
        // Pure simulation mode: do NOT force override user's saved simulation rain intensity
      } catch (err) {
        console.warn('Live rain API using cached fallback:', err);
      }

      setLoading(false);
    }

    initData();
  }, []);

  // ─── Trigger Simulation ───────────────────────────────────
  const runSimulation = useCallback(
    async (rain: number, stormMinutes: number, blocked: string[]) => {
      // 1. Instant Synchronous Cache Check (0ms latency, eliminates lag)
      const cached = getCachedSimulate(rain, stormMinutes, blocked);
      if (cached) {
        setNodes(cached.nodes);
        setSummary(cached.summary);
        setIsLiveConnected(true);
        setLoading(false);
        return;
      }

      // 2. Abort prior in-flight request to avoid backlog
      if (simAbortController.current) {
        simAbortController.current.abort();
      }
      simAbortController.current = new AbortController();

      setLoading(true);
      try {
        const res = await simulate(rain, stormMinutes, blocked, simAbortController.current.signal);
        setNodes(res.nodes);
        setSummary(res.summary);
        setIsLiveConnected(true);
        if (res.summary) {
          const crit = res.summary.risk_breakdown?.CRITICAL ?? 0;
          addToast(
            crit > 0
              ? `⚠️ ${crit} CRITICAL zones detected — ${res.summary.flooded_nodes} flooded`
              : `✅ Simulation updated — ${res.summary.flooded_nodes} nodes waterlogged`,
            crit > 0 ? 'warning' : 'success'
          );
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn('Simulation using local physical solver fallback:', err);
        const res = simulateLocal(rain, stormMinutes, blocked);
        setNodes(res.nodes);
        setSummary(res.summary);
      } finally {
        setLoading(false);
      }
    },
    [addToast]
  );

  // Debounced effect whenever rain intensity, storm duration, or blocked nodes change
  useEffect(() => {
    // Check cache immediately for instant UI update
    const instantCached = getCachedSimulate(rainMm, minutes, blockedNodes);
    if (instantCached) {
      setNodes(instantCached.nodes);
      setSummary(instantCached.summary);
    }

    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = window.setTimeout(() => {
      runSimulation(rainMm, minutes, blockedNodes);
    }, 120);

    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [rainMm, minutes, blockedNodes, runSimulation]);

  // ─── Immediate Route Invalidation ─────────────────────────
  useEffect(() => {
    setRoutePath([]);
  }, [rainMm, minutes, blockedNodes, routeSource, routeTarget]);

  // ─── Ambulance Route Calculation ──────────────────────────
  const runRouting = useCallback(
    async (src: string, tgt: string, rain: number, stormMinutes: number, blocked: string[], currentDepths?: Record<string, number>) => {
      if (!showRoute || !src || !tgt) {
        setRoutePath([]);
        setRouteResult(null);
        return;
      }

      // 1. Instant Cache Check for 0ms Route Response
      const cached = getCachedRoute(src, tgt, rain, 15, stormMinutes, blocked, currentDepths);
      if (cached) {
        setRouteResult(cached);
        setRoutePath(cached.reachable ? (cached.path_coords || []) : []);
        return;
      }

      if (routeAbortController.current) {
        routeAbortController.current.abort();
      }
      routeAbortController.current = new AbortController();

      try {
        const res = await findRoute(src, tgt, rain, 15, stormMinutes, blocked, currentDepths, routeAbortController.current.signal);
        setRouteResult(res);
        if (res.reachable) {
          setRoutePath(res.path_coords || []);
          addToast(
            res.is_rerouted
              ? `🔄 Flood bypass found — ${res.distance_m}m via ${res.blocked_count} rerouted zones`
              : `🚑 Safe route ready — ${res.distance_m}m · ETA ~${Math.ceil(res.eta_safe_sec / 60)}min`,
            'success', '🚑'
          );
        } else {
          setRoutePath([]);
          addToast('⛔ No safe route — all corridors submerged!', 'error', '🚨');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn('Routing using local Dijkstra fallback solver:', err);
        const res = findRouteLocal(src, tgt, rain, 15, stormMinutes, blocked, currentDepths);
        setRouteResult(res);
        if (res.reachable) {
          setRoutePath(res.path_coords || []);
          addToast(`🚑 Safe route (local) — ${res.distance_m}m`, 'success');
        } else {
          setRoutePath([]);
          addToast('⛔ No safe route — all corridors submerged!', 'error', '🚨');
        }
      }
    },
    [showRoute, addToast]
  );

  useEffect(() => {
    if (showRoute && nodes.length > 0) {
      const depthsMap: Record<string, number> = {};
      nodes.forEach(n => { depthsMap[n.node_id] = n.depth_cm; });
      runRouting(routeSource, routeTarget, rainMm, minutes, blockedNodes, depthsMap);
    } else {
      setRoutePath([]);
      setRouteResult(null);
    }
  }, [showRoute, routeSource, routeTarget, rainMm, minutes, blockedNodes, nodes, runRouting]);

  // ─── Auto Emergency Mission Simulation Controller ──────────
  const stopAutoSim = useCallback(() => {
    autoSimTimersRef.current.forEach(t => window.clearTimeout(t));
    autoSimTimersRef.current = [];
    setIsAutoSim(false);
    setAutoSimStep(0);
    setSimAmbulanceCoord(null);
    setAutoSimMessage('');
  }, []);

  const startAutoSim = useCallback(() => {
    // Clear any existing active simulation timers
    autoSimTimersRef.current.forEach(t => window.clearTimeout(t));
    autoSimTimersRef.current = [];

    // Map current depths
    const depthsMap: Record<string, number> = {};
    nodes.forEach(n => { depthsMap[n.node_id] = n.depth_cm; });

    // Dynamically search for the most efficient pair with AT LEAST 1 safe route
    const optimalPair = findOptimalSafeRoutePair(rainMm, minutes, blockedNodes, depthsMap);

    const srcId = optimalPair ? optimalPair.source : 'kashmere_gate_isbt';
    const tgtId = optimalPair ? optimalPair.target : 'cp_outer_n';
    const srcNameClean = optimalPair ? optimalPair.sourceName.replace(/^\d+\.\s*/, '') : 'Kashmere Gate ISBT';
    const tgtNameClean = optimalPair ? optimalPair.targetName.replace(/^\d+\.\s*/, '') : 'CP Outer Circle North';

    setIsAutoSim(true);
    setAutoSimStep(1);
    setAutoSimMessage(`⛈️ STAGE 1: Storm Simulation Active (${rainMm} mm/hr for ${minutes} min) — Calculating hydrologic runoff & catchment ponding...`);

    // Stage 1: Active storm setup using slider values
    setBlockedNodes([]);
    setChokeMode(false);
    setRouteSource(srcId);
    setRouteTarget(tgtId);
    setShowRoute(true);
    setSimAmbulanceCoord(null);

    if (optimalPair && optimalPair.route) {
      setRouteResult(optimalPair.route);
      if (optimalPair.route.reachable) {
        setRoutePath(optimalPair.route.path_coords || []);
      }
    }

    // Stage 2: Emergency Alert Ingress (T = 2.4s)
    const t2 = window.setTimeout(() => {
      setAutoSimStep(2);
      setAutoSimMessage(`🚨 STAGE 2: Emergency Dispatch Ingress! Auto-selected optimal origin [${srcNameClean}] to destination [${tgtNameClean}] (${rainMm} mm/hr rain).`);
    }, 2400);
    autoSimTimersRef.current.push(t2);

    // Stage 3: Agastya Model Computes Safe Detour (T = 4.8s)
    const t3 = window.setTimeout(() => {
      setAutoSimStep(3);
      const distStr = optimalPair?.route?.distance_m ? `${optimalPair.route.distance_m}m` : 'safe corridor';
      const etaStr = optimalPair?.route?.eta_safe_sec ? `~${Math.ceil(optimalPair.route.eta_safe_sec / 60)} min` : 'optimal ETA';
      const rerouteStr = optimalPair?.route?.is_rerouted ? 'with dynamic flood bypass' : 'via direct safe street network';
      setAutoSimMessage(`🧠 STAGE 3: Agastya AI Routing Active! Safe route predicted (${distStr} · ETA ${etaStr}) from ${srcNameClean} ➔ ${tgtNameClean} ${rerouteStr} (≤15cm clearance).`);
    }, 4800);
    autoSimTimersRef.current.push(t3);

    // Stage 4: Live Ambulance Transit (T = 7.2s to 18.0s)
    const t4 = window.setTimeout(() => {
      setAutoSimStep(4);
      setAutoSimMessage(`🚑 STAGE 4: Ambulance DL-1R-9988 in transit from ${srcNameClean} to ${tgtNameClean} (${rainMm} mm/hr storm environment)...`);

      // Dynamic waypoints calculated from Dijkstra safe path coordinates
      const waypoints = (optimalPair?.route?.path_coords && optimalPair.route.path_coords.length >= 2)
        ? optimalPair.route.path_coords.map((pt: any) => ({ lat: pt.lat, lon: pt.lon, name: pt.name }))
        : [
            { lat: 28.5652, lon: 77.2341, name: 'Moolchand Flyover West' },
            { lat: 28.5720, lon: 77.2380, name: 'Lajpat Nagar Ring Road' },
            { lat: 28.5880, lon: 77.2530, name: 'Hazrat Nizamuddin Railway Flyover' },
            { lat: 28.6020, lon: 77.2440, name: 'Sunder Nagar / Zoo Arc' },
            { lat: 28.6129, lon: 77.2295, name: 'India Gate Outer C-Hexagon' },
            { lat: 28.6180, lon: 77.2210, name: 'Windsor Place Ingress' },
            { lat: 28.6225, lon: 77.2185, name: 'Janpath Junction' },
            { lat: 28.6275, lon: 77.2190, name: 'CP Outer Circle South' },
          ];

      const totalPoints = waypoints.length;
      const stepDuration = Math.max(700, Math.floor(9500 / totalPoints));
      waypoints.forEach((pt: any, idx: number) => {
        const stepDelay = 400 + (idx * stepDuration);
        const transitTimer = window.setTimeout(() => {
          const progress = Math.min(100, Math.round(((idx + 1) / totalPoints) * 100));
          setSimAmbulanceCoord({
            lat: pt.lat,
            lon: pt.lon,
            name: pt.name,
            progress,
          });
        }, stepDelay);
        autoSimTimersRef.current.push(transitTimer);
      });
    }, 7200);
    autoSimTimersRef.current.push(t4);

    // Stage 5: Mission Accomplished & User Handover (T = 18.0s)
    const lastPt = (optimalPair?.route?.path_coords && optimalPair.route.path_coords.length > 0)
      ? optimalPair.route.path_coords[optimalPair.route.path_coords.length - 1]
      : { lat: 28.6275, lon: 77.2190, name: tgtNameClean };

    const t5 = window.setTimeout(() => {
      setAutoSimStep(5);
      setAutoSimMessage(`✅ STAGE 5: MISSION ACCOMPLISHED! Ambulance safely reached ${tgtNameClean} from ${srcNameClean} under ${rainMm} mm/hr storm conditions.`);
      setSimAmbulanceCoord({
        lat: lastPt.lat,
        lon: lastPt.lon,
        name: lastPt.name || tgtNameClean,
        progress: 100,
      });
    }, 18000);
    autoSimTimersRef.current.push(t5);
  }, [rainMm, minutes, blockedNodes, nodes]);
  void startAutoSim;

  // ─── Node Click & Route Selection Handlers ──────────────────
  const handleSelectOrigin = (nodeId: string) => {
    if (isAutoSim) stopAutoSim();
    setRouteSource(nodeId);
    setShowRoute(true);
  };

  const handleSelectTarget = (nodeId: string) => {
    if (isAutoSim) stopAutoSim();
    setRouteTarget(nodeId);
    setShowRoute(true);
  };

  const handleSwapRoute = () => {
    if (isAutoSim) stopAutoSim();
    const temp = routeSource;
    setRouteSource(routeTarget);
    setRouteTarget(temp);
    setShowRoute(true);
  };

  const handleClearRoute = () => {
    if (isAutoSim) stopAutoSim();
    setShowRoute(false);
    setRoutePath([]);
    setRouteResult(null);
  };

  // ─── Unified Node Click Handler ───────────────────────────
  const handleNodeClick = (nodeId: string) => {
    if (isAutoSim) stopAutoSim();
    // If choke mode is active, handle manhole block/unblock
    if (chokeMode) {
      if (blockedNodes.includes(nodeId)) {
        setBlockedNodes(prev => prev.filter(id => id !== nodeId));
        return;
      }
      if (nodeId === routeSource || nodeId === routeTarget) {
        alert(`🛡️ Routing endpoint '${CATCHMENT_NODES[nodeId]?.name || nodeId}' cannot be blocked in choke mode.`);
        return;
      }
      setBlockedNodes(prev => [...prev, nodeId]);
      return;
    }

    // Interactive 2-Point Route Selection when clicking on map:
    // If route is not currently active, set this node as Start (Origin) and turn on routing
    if (!showRoute) {
      setRouteSource(nodeId);
      setShowRoute(true);
      return;
    }

    // If route is active:
    // If clicking the current source, no-op or re-confirm
    if (nodeId === routeSource) {
      return;
    }

    // Otherwise, set as Destination and compute shortest/safest route immediately
    setRouteTarget(nodeId);
  };

  // ─── Direct Pothole / Manhole Choke Toggle Handler ─────────
  const handleToggleBlockNode = (nodeId: string) => {
    if (isAutoSim) stopAutoSim();
    setBlockedNodes(prev => {
      if (prev.includes(nodeId)) {
        return prev.filter(id => id !== nodeId);
      } else {
        return [...prev, nodeId];
      }
    });
  };

  const handleClearBlockedNodes = () => {
    if (isAutoSim) stopAutoSim();
    setBlockedNodes([]);
  };

  // ─── Active Route Choke Handler (Right-Center HUD) ───────
  const handleChokeActiveRoute = useCallback(() => {
    if (isAutoSim) stopAutoSim();

    if (!routeResult) {
      addToast('⚠️ No active route to choke. Please select a route first.', 'warning');
      return;
    }

    const pathNodes: string[] = routeResult.path_nodes || routeResult.path || (routeResult.path_coords || []).map((p: PathCoord) => p.node_id);
    if (pathNodes.length === 0) {
      addToast('⚠️ No active route to choke. Please select a route first.', 'warning');
      return;
    }

    const blockedSet = new Set(blockedNodes);

    // Filter eligible intermediate nodes along current route that are not yet choked
    let eligible = pathNodes.filter((id: string, idx: number) => {
      if (blockedSet.has(id)) return false;
      if (id === routeSource || id === routeTarget) return false;
      if (idx === 0 || idx === pathNodes.length - 1) return false;
      return true;
    });

    // If no intermediate nodes left, try any unblocked node on path except origin
    if (eligible.length === 0) {
      eligible = pathNodes.filter((id: string) => !blockedSet.has(id) && id !== routeSource);
    }

    if (eligible.length === 0) {
      addToast('⚠️ All available nodes on this corridor are already choked!', 'warning');
      return;
    }

    // Pick node with maximum depth or first eligible node
    let targetNode = eligible[0];
    let maxD = -1;
    for (const nid of eligible) {
      const nodeObj = nodes.find(n => n.node_id === nid);
      const depth = nodeObj ? nodeObj.depth_cm : 0;
      if (depth > maxD) {
        maxD = depth;
        targetNode = nid;
      }
    }

    const newBlocked = [...blockedNodes, targetNode];
    setBlockedNodes(newBlocked);

    const nodeInfo = nodes.find(n => n.node_id === targetNode);
    const nodeName = nodeInfo?.name || targetNode;

    addToast(`🚫 Route Choked at ${nodeName}! Rerouting safe path...`, 'warning', '⚡');
  }, [isAutoSim, stopAutoSim, routeResult, blockedNodes, routeSource, routeTarget, nodes, addToast]);

  // ─── Guided Demo Mode Presets ─────────────────────────────
  const setDemoPreset = (step: number) => {
    if (isAutoSim) stopAutoSim();
    switch (step) {
      case 1: // Dry Baseline (0 mm/hr, all depths = 0)
        setRainMm(0);
        setMinutes(30);
        setBlockedNodes([]);
        setShowRoute(false);
        setChokeMode(false);
        break;
      case 2: // Moderate Rain (35 mm/hr, all 25 nodes active)
        setRainMm(35);
        setMinutes(30);
        setBlockedNodes([]);
        setShowRoute(false);
        setChokeMode(false);
        break;
      case 3: // Monsoon Downpour (75 mm/hr, >30cm Minto underpass sag)
        setRainMm(75);
        setMinutes(30);
        setBlockedNodes([]);
        setShowRoute(false);
        setChokeMode(false);
        break;
      case 4: // Safe AI Route Bypass to Hospital
        setRainMm(60);
        setMinutes(30);
        setBlockedNodes([]);
        setChokeMode(false);
        setRouteSource('moolchand_flyover_w');
        setRouteTarget('cp_outer_s');
        setShowRoute(true);
        break;
      default: // Reset Simulation to baseline
        setRainMm(35);
        setMinutes(30);
        setBlockedNodes([]);
        setShowRoute(false);
        setChokeMode(false);
        setRouteSource('moolchand_flyover_w');
        setRouteTarget('cp_outer_s');
        setRouteResult(null);
        setRoutePath([]);
        break;
    }
  };

  const criticalCount = summary?.risk_breakdown?.CRITICAL ?? 0;
  const highCount = summary?.risk_breakdown?.HIGH ?? 0;
  const mediumCount = summary?.risk_breakdown?.MEDIUM ?? 0;
  const maxDepth = summary?.max_depth_cm ?? 0;
  const floodedCount = summary?.flooded_nodes ?? 0;

  return (
    <div className="app-layout">
      {/* ─── Left Sidebar ─── */}
      <Sidebar
        rainMm={rainMm}
        onRainChange={(v) => {
          if (isAutoSim) stopAutoSim();
          setRainMm(v);
        }}
        minutes={minutes}
        onMinutesChange={(v) => {
          if (isAutoSim) stopAutoSim();
          setMinutes(v);
        }}
        summary={summary}
        rainData={rainData}
        chokeMode={chokeMode}
        onChokeModeToggle={() => {
          if (isAutoSim) stopAutoSim();
          setChokeMode(prev => !prev);
        }}
        blockedNodes={blockedNodes}
        onClearBlockedNodes={handleClearBlockedNodes}
        showRoute={showRoute}
        onRouteToggle={() => {
          if (isAutoSim) stopAutoSim();
          setShowRoute(prev => !prev);
        }}
        routeSource={routeSource}
        onRouteSourceChange={(src) => {
          if (isAutoSim) stopAutoSim();
          setRouteSource(src);
        }}
        routeResult={routeResult}
        nodes={nodes}
        nodeList={nodeList}
        loading={loading}
        onOpenDrawer={() => setIsDrawerOpen(true)}
        isAutoSim={isAutoSim}
        autoSimStep={autoSimStep}
        onStartAutoSim={startAutoSim}
        onStopAutoSim={stopAutoSim}
      />

      {/* ─── Main Content ─── */}
      <main className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* ─── Top Operator KPI Header ─── */}
        <header
          style={{
            padding: '10px 18px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.04em', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🌊 AGASTYA</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                  SIH Problem 26085
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Minto Bridge Urban Flood Nowcasting & Emergency Routing
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Live / Offline status badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  background: isLiveConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  border: isLiveConnected ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                  color: isLiveConnected ? '#34d399' : '#fbbf24',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isLiveConnected ? '#10b981' : '#f59e0b',
                    boxShadow: isLiveConnected ? '0 0 8px #10b981' : '0 0 8px #f59e0b',
                    display: 'inline-block',
                  }}
                />
                <span>{isLiveConnected ? 'LIVE FASTAPI API' : 'OFFLINE DEMO MODE'}</span>
              </div>

              {/* Weather feed pill */}
              <div
                style={{
                  padding: '4px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(59, 130, 246, 0.12)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  color: '#93c5fd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>🌧️ Open-Meteo:</span>
                <span style={{ fontWeight: 800, color: '#ffffff' }}>
                  {rainData?.current_rain_mm !== undefined ? `${rainData.current_rain_mm} mm/hr` : `${rainMm} mm/hr`}
                </span>
              </div>

              {/* Collapse/Expand Header Toggle */}
              <button
                type="button"
                onClick={() => setIsHeaderCollapsed(prev => !prev)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  color: '#cbd5e1',
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '4px 9px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={isHeaderCollapsed ? 'Expand Dashboard Header Bar' : 'Collapse Header Bar for Full-Screen View'}
              >
                <span>{isHeaderCollapsed ? '▼ Expand Bar' : '▲ Collapse Bar'}</span>
              </button>
            </div>
          </div>

          {/* Top KPI Metrics Cards & Guided Demo Quick Action Bar (Collapsible) */}
          {!isHeaderCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* KPI 1: Rain */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Rain Rate</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8' }}>{rainMm} mm/hr</span>
              </div>
              {/* KPI 2: Max Depth */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Max Sag Depth</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: maxDepth >= 30 ? '#ef4444' : maxDepth >= 15 ? '#f97316' : '#34d399' }}>
                  {maxDepth.toFixed(1)} cm
                </span>
              </div>
              {/* KPI 3: High Risk Nodes */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>High/Critical</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: (criticalCount + highCount) > 0 ? '#ef4444' : '#10b981' }}>
                  {criticalCount + highCount}
                </span>
              </div>
              {/* KPI 4: Caution Nodes */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Medium Risk</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{mediumCount}</span>
              </div>
              {/* KPI 5: Flooded Sectors */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Flooded Sectors</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: floodedCount > 0 ? '#f97316' : '#10b981' }}>{floodedCount}</span>
              </div>
              {/* KPI 6: Network Density */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Network Nodes</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8' }}>{nodes.length}</span>
              </div>
            </div>

            {/* Quick Demo Stepper Buttons for Judges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginRight: 2 }}>Demo:</span>
              <button
                type="button"
                onClick={() => setDemoPreset(1)}
                style={{ padding: '3px 7px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: rainMm === 0 ? '#3b82f6' : 'rgba(255,255,255,0.06)', color: 'white', cursor: 'pointer' }}
                title="Scenario 1: Baseline Dry Rain = 0 mm/hr"
              >
                1. Dry
              </button>
              <button
                type="button"
                onClick={() => setDemoPreset(2)}
                style={{ padding: '3px 7px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: rainMm === 35 && !showRoute ? '#3b82f6' : 'rgba(255,255,255,0.06)', color: 'white', cursor: 'pointer' }}
                title="Scenario 2: Moderate Rain 35 mm/hr"
              >
                2. Moderate
              </button>
              <button
                type="button"
                onClick={() => setDemoPreset(3)}
                style={{ padding: '3px 7px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: rainMm === 75 && !showRoute ? '#3b82f6' : 'rgba(255,255,255,0.06)', color: 'white', cursor: 'pointer' }}
                title="Scenario 3: Monsoon Downpour 75 mm/hr (>30cm at Minto Sag)"
              >
                3. Downpour
              </button>
              <button
                type="button"
                onClick={() => setDemoPreset(4)}
                style={{ padding: '3px 7px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(16,185,129,0.4)', background: showRoute ? '#10b981' : 'rgba(16,185,129,0.15)', color: 'white', cursor: 'pointer' }}
                title="Scenario 4: Safe Ambulance Route avoiding Minto Underpass to AIIMS"
              >
                4. Safe Route
              </button>
              <button
                type="button"
                onClick={() => setDemoPreset(0)}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
                title="Reset simulation parameters, rain, and route"
              >
                ↺ RESET
              </button>
            </div>
          </div>
        )}
      </header>

        {/* Route Safety Warning Banner */}
        {showRoute && routeResult && !routeResult.reachable && (
          <div
            id="route-safety-banner"
            style={{
              background: 'linear-gradient(90deg, #7f1d1d 0%, #991b1b 100%)',
              color: '#ffffff',
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '2px solid #ef4444',
              boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
              zIndex: 10,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>🚨</span>
              <div>
                <span style={{ fontWeight: 800, color: '#fef08a', textTransform: 'uppercase', marginRight: 8, letterSpacing: '0.04em' }}>
                  {routeResult.reason === 'ORIGIN_UNSAFE'
                    ? 'Origin Unsafe — Deployment Infeasible'
                    : routeResult.reason === 'DESTINATION_UNSAFE'
                    ? 'Destination Unsafe — Facility Inaccessible'
                    : 'No Safe Evacuation Route'}
                </span>
                <span style={{ color: '#fecaca' }}>{routeResult.message}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#fef08a', fontWeight: 800, background: 'rgba(0,0,0,0.35)', padding: '3px 8px', borderRadius: 6, flexShrink: 0 }}>
              Threshold: &le;15.0 cm
            </div>
          </div>
        )}

        {/* Map Container */}
        <div className="map-container" style={{ flex: 1, position: 'relative' }}>
          <FloodMap
            nodes={nodes}
            edges={edges}
            potholes={potholes}
            routePath={routePath}
            normalPathCoords={routeResult?.normal_path_coords || []}
            routeResult={routeResult}
            showRoute={showRoute}
            chokeMode={chokeMode}
            blockedNodes={blockedNodes}
            onNodeClick={handleNodeClick}
            onSelectOrigin={handleSelectOrigin}
            onSelectTarget={handleSelectTarget}
            onSwapRoute={handleSwapRoute}
            onClearRoute={handleClearRoute}
            center={mapCenter}
            zoom={zoom}
            routeSource={routeSource}
            routeTarget={routeTarget}
            isAutoSim={isAutoSim}
            autoSimStep={autoSimStep}
            autoSimMessage={autoSimMessage}
            simAmbulanceCoord={simAmbulanceCoord}
            onStopAutoSim={stopAutoSim}
            onClearBlockedNodes={handleClearBlockedNodes}
            onToggleBlockNode={handleToggleBlockNode}
            onChokeActiveRoute={handleChokeActiveRoute}
          />

          {/* Map Color Legend */}
          <div className="map-legend">
            <div className="legend-title">Flood Depth & Risk Legend</div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#ef4444' }} />
              <span>Critical (≥ 30 cm) · Submerged</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#f97316' }} />
              <span>High (20–30 cm) · Impassable</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#f59e0b' }} />
              <span>Medium (10–20 cm) · Caution</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#10b981' }} />
              <span>Safe (&lt; 10 cm) · Passable Corridor</span>
            </div>
            <div style={{ margin: '6px 0 4px', borderTop: '1px solid var(--border-subtle)' }} />
            <div className="legend-item">
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#6366f1', border: '2px solid white' }} />
              <span>🏥 Destination (Exit / Hospital)</span>
            </div>
            <div className="legend-item">
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', border: '2px solid white' }} />
              <span>🚑 Dispatch Origin</span>
            </div>
            <div className="legend-item">
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px dashed #dc2626', background: 'rgba(239, 68, 68, 0.3)' }} />
              <span>🚫 Blocked Manhole (Choke)</span>
            </div>
            <div className="legend-item">
              <div style={{ width: 14, height: 2, borderTop: '1px dashed #3b82f6' }} />
              <span>Stormwater Drain / Sewer Conduit</span>
            </div>
            {showRoute && (
              <div className="legend-item">
                <div style={{ width: 14, height: 3, background: '#10b981', borderRadius: 2 }} />
                <span>Safe Ambulance Corridor (&lt;15cm)</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Floating Alerts, Route & PySewer Panel */}
        <AlertPanel
          nodes={nodes}
          routeResult={routeResult}
          showRoute={showRoute}
        />

        {/* Bottom Status Bar with Honest Scientific Labels */}
        <footer className="status-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`status-dot ${isLiveConnected ? 'status-dot-live' : 'status-dot-offline'}`} />
            <span>
              {isLiveConnected
                ? 'FastAPI Hydro Engine · 1D Manning Pipe Flow & Overland Surcharge'
                : 'Offline Demo Mode · Local 1D Hydro Solver Active'}
            </span>
          </div>
          <div>
            Catchment: <strong style={{ color: 'var(--text-primary)' }}>Minto Bridge (28.6280° N, 77.2197° E)</strong> · 25 Nodes · 39 Links · Elevation 210.5m – 216.5m
          </div>
          <div>
            Storm Window: <strong style={{ color: 'var(--accent-cyan)' }}>{minutes} min</strong> · Blocked:{' '}
            <strong style={{ color: blockedNodes.length > 0 ? '#ef4444' : 'var(--text-primary)' }}>
              {blockedNodes.length}
            </strong>
          </div>
        </footer>
      </main>
      {/* ─── Math Basis & Route Rationale Side Drawer ─── */}
      <CalculationDrawer
        rainMm={rainMm}
        minutes={minutes}
        routeResult={routeResult}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />

      {/* ─── Toast Notification System ─── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
