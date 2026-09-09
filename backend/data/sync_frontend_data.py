"""
Synchronize network.json to frontend/src/lib/networkData.ts
"""
import json
from pathlib import Path

network_json_path = Path(__file__).resolve().parent / "cache" / "network.json"
frontend_ts_path = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "networkData.ts"

with open(network_json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes = data["nodes"]
edges = data["edges"]
potholes = data.get("potholes", [])

nodes_ts = json.dumps(nodes, indent=2)
edges_ts = json.dumps(edges, indent=2)
potholes_ts = json.dumps(potholes, indent=2)

ts_template = '''import type { NodeDepth, NetworkEdge, SimulateResponse, RouteResponse, PathCoord, PotholeHazard, AlternateRouteInfo } from "./api";

export interface CatchmentNodeInfo {
  lat: number;
  lon: number;
  elevation: number;
  catch_area: number;
  name: string;
  role?: "sag" | "hospital" | "railway" | "junction";
}

export const CATCHMENT_NODES: Record<string, CatchmentNodeInfo> = __NODES_TS__;

export const INITIAL_EDGES: NetworkEdge[] = __EDGES_TS__;

export const POTHOLE_HAZARDS: PotholeHazard[] = __POTHOLES_TS__;

export const INITIAL_NODES: NodeDepth[] = Object.entries(CATCHMENT_NODES).map(([id, info]) => ({
  node_id: id,
  id: id,
  name: info.name,
  lat: info.lat,
  lon: info.lon,
  lng: info.lon,
  depth_cm: 0.0,
  depth: 0.0,
  risk_level: "SAFE" as const,
  risk: "SAFE" as const,
  blocked: false,
  role: info.role || "junction",
}));

export function simulateLocal(rainMmHr: number, minutes: number, blockedNodes: string[] = []): SimulateResponse {
  const blockedSet = new Set(blockedNodes);
  const minElev = 208.0;
  const maxElev = 232.0;
  const durationFactor = Math.min(1.0, minutes / 30.0);
  const depths: Record<string, number> = {};
  const isZeroRain = rainMmHr <= 0.0;

  for (const [nodeId, info] of Object.entries(CATCHMENT_NODES)) {
    if (isZeroRain) {
      depths[nodeId] = 0.0;
      continue;
    }
    const elev = info.elevation;
    const invElevNorm = Math.max(0, (maxElev - elev) / (maxElev - minElev));
    const isSag = info.role === "sag" || nodeId.includes("sag") || nodeId.includes("underpass") || nodeId.includes("tunnel");
    const sagFactor = isSag ? 2.2 : 0.8;
    const isBlocked = blockedSet.has(nodeId);
    const chokeFactor = isBlocked ? 2.5 : 1.0;
    const catchFactor = (info.catch_area || 3000) / 3000;

    let depth = (rainMmHr / 75.0) * 14.0 * invElevNorm * sagFactor * chokeFactor * catchFactor * durationFactor;
    if (isSag && rainMmHr >= 60.0) {
      depth = Math.max(depth, 32.0 * (rainMmHr / 75.0) * chokeFactor);
    }
    if (isBlocked) {
      depth = Math.max(depth, 16.0);
    }
    depths[nodeId] = Number(Math.max(0, depth).toFixed(1));
  }

  const nodeDepths: NodeDepth[] = Object.entries(CATCHMENT_NODES).map(([id, info]) => {
    const d = depths[id] || 0;
    let risk_level: "SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "SAFE";
    if (d >= 30) risk_level = "CRITICAL";
    else if (d >= 20) risk_level = "HIGH";
    else if (d >= 10) risk_level = "MEDIUM";
    else if (d >= 3) risk_level = "LOW";

    return {
      node_id: id,
      id: id,
      name: info.name,
      lat: info.lat,
      lon: info.lon,
      lng: info.lon,
      depth_cm: d,
      depth: d,
      risk_level,
      risk: risk_level,
      blocked: blockedSet.has(id),
      role: info.role || "junction",
    };
  });

  const depthValues = Object.values(depths);
  const flooded = depthValues.filter(d => d >= 10);
  const maxDepth = depthValues.length > 0 ? Math.max(...depthValues) : 0;
  const avgDepth = depthValues.length > 0 ? depthValues.reduce((a, b) => a + b, 0) / depthValues.length : 0;
  const avgFlooded = flooded.length > 0 ? flooded.reduce((a, b) => a + b, 0) / flooded.length : 0;

  const risk_breakdown = {
    CRITICAL: nodeDepths.filter(n => n.risk_level === "CRITICAL").length,
    HIGH: nodeDepths.filter(n => n.risk_level === "HIGH").length,
    MEDIUM: nodeDepths.filter(n => n.risk_level === "MEDIUM").length,
    LOW: nodeDepths.filter(n => n.risk_level === "LOW").length,
    SAFE: nodeDepths.filter(n => n.risk_level === "SAFE").length,
  };

  return {
    depths,
    nodes: nodeDepths,
    summary: {
      total_nodes: nodeDepths.length,
      flooded_nodes: flooded.length,
      max_depth_cm: Number(maxDepth.toFixed(1)),
      avg_depth_cm: Number(avgDepth.toFixed(1)),
      avg_flooded_depth_cm: Number(avgFlooded.toFixed(1)),
      risk_breakdown,
    },
    rain_mm: rainMmHr,
    minutes,
  };
}

export function findRouteLocal(
  source: string,
  target: string,
  rainMmHr: number,
  thresholdCm: number = 15.0,
  minutes: number = 30,
  blockedNodes: string[] = [],
  currentDepths?: Record<string, number>
): RouteResponse {
  const depths = currentDepths || simulateLocal(rainMmHr, minutes, blockedNodes).depths;
  const blockedSet = new Set(blockedNodes);

  const adj: Record<string, { node: string; dist: number }[]> = {};
  for (const id of Object.keys(CATCHMENT_NODES)) {
    adj[id] = [];
  }
  for (const edge of INITIAL_EDGES) {
    const u = edge.from || edge.from_id;
    const v = edge.to || edge.to_id;
    if (u && v && adj[u] && adj[v]) {
      const d = edge.length_m || edge.length || 200;
      adj[u].push({ node: v, dist: d });
      adj[v].push({ node: u, dist: d });
    }
  }

  // 1. Unconstrained baseline shortest path
  const normalDist: Record<string, number> = {};
  const normalPrev: Record<string, string | null> = {};
  const normalQ = new Set(Object.keys(CATCHMENT_NODES));
  for (const id of Object.keys(CATCHMENT_NODES)) {
    normalDist[id] = Infinity;
    normalPrev[id] = null;
  }
  if (normalDist[source] !== undefined) normalDist[source] = 0;

  while (normalQ.size > 0) {
    let u: string | null = null;
    let minD = Infinity;
    for (const node of normalQ) {
      if (normalDist[node] < minD) {
        minD = normalDist[node];
        u = node;
      }
    }
    if (!u || minD === Infinity) break;
    normalQ.delete(u);
    if (u === target) break;

    for (const neighbor of adj[u] || []) {
      if (normalQ.has(neighbor.node)) {
        const alt = normalDist[u] + neighbor.dist;
        if (alt < normalDist[neighbor.node]) {
          normalDist[neighbor.node] = alt;
          normalPrev[neighbor.node] = u;
        }
      }
    }
  }

  const normalPath: string[] = [];
  let currN: string | null = target;
  if (normalDist[target] !== Infinity) {
    while (currN) {
      normalPath.unshift(currN);
      currN = normalPrev[currN];
    }
  }
  const normalPathCoords: PathCoord[] = normalPath.map(id => ({
    node_id: id,
    name: CATCHMENT_NODES[id]?.name || id,
    lat: CATCHMENT_NODES[id]?.lat || 0,
    lon: CATCHMENT_NODES[id]?.lon || 0,
  }));
  const normalMaxDepth = normalPath.length > 0 ? Math.max(...normalPath.map(id => depths[id] || 0)) : 0;
  const normalDistanceM = normalDist[target] !== Infinity ? Math.round(normalDist[target]) : 0;

  // Check origin and target safety
  const srcDepth = depths[source] || 0;
  const tgtDepth = depths[target] || 0;
  if (srcDepth > thresholdCm || blockedSet.has(source)) {
    return {
      path: [],
      path_coords: [],
      normal_path: normalPath,
      normal_path_coords: normalPathCoords,
      distance_m: 0,
      normal_distance_m: normalDistanceM,
      safe_distance_m: 0,
      normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),
      safe_max_depth_cm: 0,
      is_rerouted: false,
      blocked_nodes: blockedNodes,
      blocked_count: blockedNodes.length,
      eta_normal_sec: Math.round(normalDistanceM / (30000 / 3600)),
      eta_safe_sec: 0,
      eta_sec: 0,
      eta_saved_sec: 0,
      reachable: false,
      reason: "ORIGIN_UNSAFE",
      origin_depth_cm: Number(srcDepth.toFixed(1)),
      destination_depth_cm: Number(tgtDepth.toFixed(1)),
      threshold_cm: thresholdCm,
      message: `Origin '${CATCHMENT_NODES[source]?.name || source}' is submerged (${srcDepth.toFixed(1)} cm > ${thresholdCm} cm threshold). Departure unsafe.`,
    };
  }

  if (tgtDepth > thresholdCm || blockedSet.has(target)) {
    return {
      path: [],
      path_coords: [],
      normal_path: normalPath,
      normal_path_coords: normalPathCoords,
      distance_m: 0,
      normal_distance_m: normalDistanceM,
      safe_distance_m: 0,
      normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),
      safe_max_depth_cm: 0,
      is_rerouted: false,
      blocked_nodes: blockedNodes,
      blocked_count: blockedNodes.length,
      eta_normal_sec: Math.round(normalDistanceM / (30000 / 3600)),
      eta_safe_sec: 0,
      eta_sec: 0,
      eta_saved_sec: 0,
      reachable: false,
      reason: "DESTINATION_UNSAFE",
      origin_depth_cm: Number(srcDepth.toFixed(1)),
      destination_depth_cm: Number(tgtDepth.toFixed(1)),
      threshold_cm: thresholdCm,
      message: `Destination '${CATCHMENT_NODES[target]?.name || target}' is submerged (${tgtDepth.toFixed(1)} cm > ${thresholdCm} cm threshold). Inaccessible.`,
    };
  }

  // 2. Safe Dijkstra
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const Q = new Set(Object.keys(CATCHMENT_NODES));
  for (const id of Object.keys(CATCHMENT_NODES)) {
    dist[id] = Infinity;
    prev[id] = null;
  }
  dist[source] = 0;

  while (Q.size > 0) {
    let u: string | null = null;
    let minD = Infinity;
    for (const node of Q) {
      if (dist[node] < minD) {
        minD = dist[node];
        u = node;
      }
    }
    if (!u || minD === Infinity) break;
    Q.delete(u);
    if (u === target) break;

    for (const neighbor of adj[u] || []) {
      const v = neighbor.node;
      if (Q.has(v)) {
        const vDepth = depths[v] || 0;
        if (vDepth > thresholdCm || blockedSet.has(v)) {
          continue; // Inundated segment bypassed!
        }
        const alt = dist[u] + neighbor.dist;
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }
  }

  if (dist[target] === Infinity) {
    return {
      path: [],
      path_coords: [],
      normal_path: normalPath,
      normal_path_coords: normalPathCoords,
      distance_m: 0,
      normal_distance_m: normalDistanceM,
      safe_distance_m: 0,
      normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),
      safe_max_depth_cm: 0,
      is_rerouted: false,
      blocked_nodes: blockedNodes,
      blocked_count: blockedNodes.length,
      eta_normal_sec: Math.round(normalDistanceM / (30000 / 3600)),
      eta_safe_sec: 0,
      eta_sec: 0,
      eta_saved_sec: 0,
      reachable: false,
      reason: "NO_SAFE_PATH",
      origin_depth_cm: Number(srcDepth.toFixed(1)),
      destination_depth_cm: Number(tgtDepth.toFixed(1)),
      threshold_cm: thresholdCm,
      message: `No safe route available between '${CATCHMENT_NODES[source]?.name || source}' and '${CATCHMENT_NODES[target]?.name || target}' with water depth <= ${thresholdCm} cm.`,
    };
  }

  const path: string[] = [];
  let curr: string | null = target;
  while (curr) {
    path.unshift(curr);
    curr = prev[curr];
  }

  const safeDist = dist[target];
  const speedMps = 30000 / 3600;
  const etaNormal = (normalDistanceM / speedMps);
  const etaSafe = safeDist / speedMps;
  const detourDelay = Math.max(0, etaSafe - etaNormal);
  const detourExtra = Math.max(0, safeDist - normalDistanceM);
  const safeMaxDepth = path.length > 0 ? Math.max(...path.map(id => depths[id] || 0)) : 0;
  const isRerouted = (path.join(",") !== normalPath.join(",")) && (normalMaxDepth > thresholdCm);

  const pathCoords: PathCoord[] = path.map(id => ({
    node_id: id,
    name: CATCHMENT_NODES[id]?.name || id,
    lat: CATCHMENT_NODES[id]?.lat || 0,
    lon: CATCHMENT_NODES[id]?.lon || 0,
  }));

  const alternateRoutes: AlternateRouteInfo[] = [];
  if (normalPath.length > 1 && (normalPath.join(",") !== path.join(",") || normalMaxDepth > 0)) {
    const normFlooded = normalPath.filter(id => (depths[id] || 0) > thresholdCm);
    let reason = "Direct shortest corridor clear of water.";
    let status = "PASSABLE_CLEAR";
    if (normalMaxDepth > 30) {
      status = "INUNDATED_CRITICAL";
      reason = `AI Rejected: Critical submergence (${normalMaxDepth.toFixed(1)} cm water). Severe risk of ambulance stalling.`;
    } else if (normalMaxDepth > thresholdCm) {
      status = "SUBMERGED_UNSAFE";
      reason = `AI Rejected: Water depth (${normalMaxDepth.toFixed(1)} cm) exceeds ${thresholdCm} cm clearance limit.`;
    } else if (normalMaxDepth > 5) {
      status = "HIGH_WATER_RISK";
      reason = `Notice: Moderate water (${normalMaxDepth.toFixed(1)} cm). Passable with caution.`;
    }

    alternateRoutes.push({
      id: "alt_direct",
      name: "Direct Shortest Corridor (Unconstrained)",
      path: normalPath,
      path_coords: normalPathCoords,
      distance_m: normalDistanceM,
      max_depth_cm: Number(normalMaxDepth.toFixed(1)),
      avg_depth_cm: Number((normalPath.reduce((acc, id) => acc + (depths[id] || 0), 0) / normalPath.length).toFixed(1)),
      flooded_nodes_count: normFlooded.length,
      flooded_nodes: normFlooded,
      status: status,
      is_safe: normalMaxDepth <= thresholdCm,
      reason_rejected: reason,
    });
  }

  return {
    path,
    path_coords: pathCoords,
    normal_path: normalPath,
    normal_path_coords: normalPathCoords,
    distance_m: Math.round(safeDist),
    normal_distance_m: normalDistanceM,
    safe_distance_m: Math.round(safeDist),
    normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),
    safe_max_depth_cm: Number(safeMaxDepth.toFixed(1)),
    is_rerouted: isRerouted,
    blocked_nodes: blockedNodes,
    blocked_count: blockedNodes.length,
    eta_normal_sec: Math.round(etaNormal),
    eta_safe_sec: Math.round(etaSafe),
    eta_sec: Math.round(etaSafe),
    eta_saved_sec: Math.round(detourDelay),
    detour_delay_sec: Math.round(detourDelay),
    detour_extra_m: Math.round(detourExtra),
    detour_m: Math.round(detourExtra),
    avoided_segments: blockedNodes.length,
    alternate_routes: alternateRoutes,
    reachable: true,
    reason: "ROUTE_FOUND",
    origin_depth_cm: Number(srcDepth.toFixed(1)),
    destination_depth_cm: Number(tgtDepth.toFixed(1)),
    threshold_cm: thresholdCm,
    message: `Safe route computed (\${Math.round(safeDist)}m) along street centerline avoiding inundated corridors.`,
  };
}

export interface DestinationItem {
  id: string;
  name: string;
  icon: string;
  area: string;
  badge: string;
}

export const STARTING_LOCATIONS_12: DestinationItem[] = [
  { id: "moolchand_flyover_w", name: "1. Moolchand Flyover West", icon: "📍", area: "Ring Road South", badge: "Primary Dispatch" },
  { id: "cp_outer_s", name: "2. CP Outer Circle South", icon: "📍", area: "Connaught Place", badge: "Emergency Response" },
  { id: "cp_outer_n", name: "3. Connaught Place North", icon: "📍", area: "CP Outer North", badge: "Radial Hub 1" },
  { id: "barakhamba_junction", name: "4. Barakhamba Road Hub", icon: "📍", area: "Connaught Place", badge: "Trauma Hub" },
  { id: "ito_junction", name: "5. ITO Medical Hub", icon: "📍", area: "ITO Junction", badge: "Super Specialty" },
  { id: "ndls_railway_station", name: "6. NDLS Station Entry", icon: "🚉", area: "Paharganj Gate", badge: "Transit Hub" },
  { id: "mandi_house", name: "7. Mandi House Circle", icon: "📍", area: "Mandi House", badge: "Apex Facility" },
  { id: "patel_chowk", name: "8. Patel Chowk Hub", icon: "📍", area: "Sansad Marg", badge: "Emergency Hub" },
  { id: "ddu_marg_east", name: "9. DDU Marg Rouse Ave", icon: "📍", area: "DDU Marg", badge: "General Hospital" },
  { id: "tagore_road", name: "10. Tagore Road Junction", icon: "📍", area: "Minto Catchment", badge: "Local Clinic" },
  { id: "cp_inner_n", name: "11. CP Radial Inner North", icon: "📍", area: "Central Park", badge: "First Aid Hub" },
  { id: "minto_north", name: "12. Minto Road North Gate", icon: "🚑", area: "Minto Ingress", badge: "Dispatch Depot" },
];

export const TOP_15_DESTINATIONS = STARTING_LOCATIONS_12;

export function preWarmAllDestinationRoutes(
  source: string,
  rainMm: number,
  thresholdCm: number = 15,
  minutes: number = 30,
  blockedNodes: string[] = []
): void {
  for (const dest of TOP_15_DESTINATIONS) {
    if (dest.id !== source) {
      findRouteLocal(source, dest.id, rainMm, thresholdCm, minutes, blockedNodes);
    }
  }
}
'''

ts_content = ts_template.replace("__NODES_TS__", nodes_ts).replace("__EDGES_TS__", edges_ts).replace("__POTHOLES_TS__", potholes_ts)

with open(frontend_ts_path, "w", encoding="utf-8") as f:
    f.write(ts_content)

print(f"Synchronized {len(nodes)} nodes, {len(edges)} edges, {len(potholes)} potholes -> {frontend_ts_path}")
