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

ts_content = f'''import type {{ NodeDepth, NetworkEdge, SimulateResponse, RouteResponse, PathCoord, PotholeHazard, AlternateRouteInfo }} from "./api";

export interface CatchmentNodeInfo {{
  lat: number;
  lon: number;
  elevation: number;
  catch_area: number;
  name: string;
  role?: "sag" | "hospital" | "railway" | "junction";
}}

export const CATCHMENT_NODES: Record<string, CatchmentNodeInfo> = {nodes_ts};

export const INITIAL_EDGES: NetworkEdge[] = {edges_ts};

export const POTHOLE_HAZARDS: PotholeHazard[] = {potholes_ts};

export const INITIAL_NODES: NodeDepth[] = Object.entries(CATCHMENT_NODES).map(([id, info]) => ({{
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
}}));

export function simulateLocal(rainMmHr: number, minutes: number, blockedNodes: string[] = []): SimulateResponse {{
  const blockedSet = new Set(blockedNodes);
  const minElev = 208.0;
  const maxElev = 232.0;
  const durationFactor = Math.min(1.0, minutes / 30.0);
  const depths: Record<string, number> = {{}};
  const isZeroRain = rainMmHr <= 0.0;

  for (const [nodeId, info] of Object.entries(CATCHMENT_NODES)) {{
    if (isZeroRain) {{
      depths[nodeId] = 0.0;
      continue;
    }}
    const elev = info.elevation;
    const invElevNorm = Math.max(0, (maxElev - elev) / (maxElev - minElev));
    const isSag = info.role === "sag" || nodeId.includes("sag") || nodeId.includes("underpass") || nodeId.includes("tunnel");
    const sagFactor = isSag ? 2.2 : 0.8;
    const isBlocked = blockedSet.has(nodeId);
    const chokeFactor = isBlocked ? 2.5 : 1.0;
    const catchFactor = (info.catch_area || 3000) / 3000;

    let depth = (rainMmHr / 75.0) * 14.0 * invElevNorm * sagFactor * chokeFactor * catchFactor * durationFactor;
    if (isSag && rainMmHr >= 60.0) {{
      depth = Math.max(depth, 32.0 * (rainMmHr / 75.0) * chokeFactor);
    }}
    if (isBlocked) {{
      depth = Math.max(depth, 16.0);
    }}
    depths[nodeId] = Number(Math.max(0, depth).toFixed(1));
  }}

  const nodeDepths: NodeDepth[] = Object.entries(CATCHMENT_NODES).map(([id, info]) => {{
    const d = depths[id] || 0;
    let risk_level: "SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "SAFE";
    if (d >= 30) risk_level = "CRITICAL";
    else if (d >= 20) risk_level = "HIGH";
    else if (d >= 10) risk_level = "MEDIUM";
    else if (d >= 3) risk_level = "LOW";

    return {{
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
    }};
  }});

  const depthValues = Object.values(depths);
  const flooded = depthValues.filter(d => d >= 10);
  const maxDepth = depthValues.length > 0 ? Math.max(...depthValues) : 0;
  const avgDepth = depthValues.length > 0 ? depthValues.reduce((a, b) => a + b, 0) / depthValues.length : 0;
  const avgFlooded = flooded.length > 0 ? flooded.reduce((a, b) => a + b, 0) / flooded.length : 0;

  const risk_breakdown = {{
    CRITICAL: nodeDepths.filter(n => n.risk_level === "CRITICAL").length,
    HIGH: nodeDepths.filter(n => n.risk_level === "HIGH").length,
    MEDIUM: nodeDepths.filter(n => n.risk_level === "MEDIUM").length,
    LOW: nodeDepths.filter(n => n.risk_level === "LOW").length,
    SAFE: nodeDepths.filter(n => n.risk_level === "SAFE").length,
  }};

  return {{
    depths,
    nodes: nodeDepths,
    summary: {{
      total_nodes: nodeDepths.length,
      flooded_nodes: flooded.length,
      max_depth_cm: Number(maxDepth.toFixed(1)),
      avg_depth_cm: Number(avgDepth.toFixed(1)),
      avg_flooded_depth_cm: Number(avgFlooded.toFixed(1)),
      risk_breakdown,
    }},
    rain_mm: rainMmHr,
    minutes,
  }};
}}

export function findRouteLocal(
  source: string,
  target: string,
  rainMmHr: number,
  thresholdCm: number = 15.0,
  minutes: number = 30,
  blockedNodes: string[] = [],
  currentDepths?: Record<string, number>
): RouteResponse {{
  const depths = currentDepths || simulateLocal(rainMmHr, minutes, blockedNodes).depths;
  const blockedSet = new Set(blockedNodes);

  const adj: Record<string, {{ node: string; dist: number }}[]> = {{}};
  for (const id of Object.keys(CATCHMENT_NODES)) {{
    adj[id] = [];
  }}
  for (const edge of INITIAL_EDGES) {{
    const u = edge.from || edge.from_id;
    const v = edge.to || edge.to_id;
    if (u && v && adj[u] && adj[v]) {{
      const d = edge.length_m || edge.length || 200;
      adj[u].push({{ node: v, dist: d }});
      adj[v].push({{ node: u, dist: d }});
    }}
  }}

  // 1. Unconstrained baseline shortest path
  const normalDist: Record<string, number> = {{}};
  const normalPrev: Record<string, string | null> = {{}};
  const normalQ = new Set(Object.keys(CATCHMENT_NODES));
  for (const id of Object.keys(CATCHMENT_NODES)) {{
    normalDist[id] = Infinity;
    normalPrev[id] = null;
  }}
  if (normalDist[source] !== undefined) normalDist[source] = 0;

  while (normalQ.size > 0) {{
    let u: string | null = null;
    let minD = Infinity;
    for (const node of normalQ) {{
      if (normalDist[node] < minD) {{
        minD = normalDist[node];
        u = node;
      }}
    }}
    if (!u || minD === Infinity) break;
    normalQ.delete(u);
    if (u === target) break;

    for (const neighbor of adj[u] || []) {{
      if (normalQ.has(neighbor.node)) {{
        const alt = normalDist[u] + neighbor.dist;
        if (alt < normalDist[neighbor.node]) {{
          normalDist[neighbor.node] = alt;
          normalPrev[neighbor.node] = u;
        }}
      }}
    }}
  }}

  const normalPath: string[] = [];
  let currN: string | null = target;
  if (normalDist[target] !== Infinity) {{
    while (currN) {{
      normalPath.unshift(currN);
      currN = normalPrev[currN];
    }}
  }}
  const normalPathCoords: PathCoord[] = normalPath.map(id => ({{
    node_id: id,
    name: CATCHMENT_NODES[id]?.name || id,
    lat: CATCHMENT_NODES[id]?.lat || 0,
    lon: CATCHMENT_NODES[id]?.lon || 0,
  }}));
  const normalMaxDepth = normalPath.length > 0 ? Math.max(...normalPath.map(id => depths[id] || 0)) : 0;
  const normalDistanceM = normalDist[target] !== Infinity ? Math.round(normalDist[target]) : 0;

  // Check origin and target safety
  const srcDepth = depths[source] || 0;
  const tgtDepth = depths[target] || 0;
  if (srcDepth > thresholdCm || blockedSet.has(source)) {{
    return {{
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
      message: `Origin '${{CATCHMENT_NODES[source]?.name || source}}' is submerged (${{srcDepth.toFixed(1)}} cm > ${{thresholdCm}} cm threshold). Departure unsafe.`,
    }};
  }}

  if (tgtDepth > thresholdCm || blockedSet.has(target)) {{
    return {{
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
      message: `Destination '${{CATCHMENT_NODES[target]?.name || target}}' is submerged (${{tgtDepth.toFixed(1)}} cm > ${{thresholdCm}} cm threshold). Inaccessible.`,
    }};
  }}

  // 2. Safe Dijkstra
  const dist: Record<string, number> = {{}};
  const prev: Record<string, string | null> = {{}};
  const Q = new Set(Object.keys(CATCHMENT_NODES));
  for (const id of Object.keys(CATCHMENT_NODES)) {{
    dist[id] = Infinity;
    prev[id] = null;
  }}
  dist[source] = 0;

  while (Q.size > 0) {{
    let u: string | null = null;
    let minD = Infinity;
    for (const node of Q) {{
      if (dist[node] < minD) {{
        minD = dist[node];
        u = node;
      }}
    }}
    if (!u || minD === Infinity) break;
    Q.delete(u);
    if (u === target) break;

    for (const neighbor of adj[u] || []) {{
      const v = neighbor.node;
      if (Q.has(v)) {{
        const vDepth = depths[v] || 0;
        if (vDepth > thresholdCm || blockedSet.has(v)) {{
          continue; // Inundated segment bypassed!
        }}
        const alt = dist[u] + neighbor.dist;
        if (alt < dist[v]) {{
          dist[v] = alt;
          prev[v] = u;
        }}
      }}
    }}
  }}

  if (dist[target] === Infinity) {{
    return {{
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
      message: `No safe route available between '${{CATCHMENT_NODES[source]?.name || source}}' and '${{CATCHMENT_NODES[target]?.name || target}}' with water depth <= ${{thresholdCm}} cm.`,
    }};
  }}

  const path: string[] = [];
  let curr: string | null = target;
  while (curr) {{
    path.unshift(curr);
    curr = prev[curr];
  }}

  const safeDist = dist[target];
  const speedMps = 30000 / 3600;
  const etaNormal = (normalDistanceM / speedMps);
  const etaSafe = safeDist / speedMps;
  const detourDelay = Math.max(0, etaSafe - etaNormal);
  const detourExtra = Math.max(0, safeDist - normalDistanceM);
  const safeMaxDepth = path.length > 0 ? Math.max(...path.map(id => depths[id] || 0)) : 0;
  const isRerouted = (path.join(",") !== normalPath.join(",")) && (normalMaxDepth > thresholdCm);

  const pathCoords: PathCoord[] = path.map(id => ({{
    node_id: id,
    name: CATCHMENT_NODES[id]?.name || id,
    lat: CATCHMENT_NODES[id]?.lat || 0,
    lon: CATCHMENT_NODES[id]?.lon || 0,
  }}));

  const alternateRoutes: AlternateRouteInfo[] = [];
  if (normalPath.length > 1 && (normalPath.join(",") !== path.join(",") || normalMaxDepth > 0)) {{
    const normFlooded = normalPath.filter(id => (depths[id] || 0) > thresholdCm);
    let reason = "Direct shortest corridor clear of water.";
    let status = "PASSABLE_CLEAR";
    if (normalMaxDepth > 30) {{
      status = "INUNDATED_CRITICAL";
      reason = `AI Rejected: Critical submergence (${{normalMaxDepth.toFixed(1)}} cm water). Severe risk of ambulance stalling.`;
    }} else if (normalMaxDepth > thresholdCm) {{
      status = "SUBMERGED_UNSAFE";
      reason = `AI Rejected: Water depth (${{normalMaxDepth.toFixed(1)}} cm) exceeds ${{thresholdCm}} cm clearance limit.`;
    }} else if (normalMaxDepth > 5) {{
      status = "HIGH_WATER_RISK";
      reason = `Notice: Moderate water (${{normalMaxDepth.toFixed(1)}} cm). Passable with caution.`;
    }}

    alternateRoutes.push({{
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
    }});
  }}

  return {{
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
  }};
}}

export interface DestinationInfo {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  icon?: string;
}

export const TOP_15_DESTINATIONS: DestinationInfo[] = [
  { id: "aiims_delhi", name: "AIIMS New Delhi (Apex Trauma Centre)", type: "hospital", lat: 28.5672, lon: 77.2100, icon: "🏥" },
  { id: "rml_hospital", name: "Dr. Ram Manohar Lohia (RML) Hospital", type: "hospital", lat: 28.6255, lon: 77.2025, icon: "🏥" },
  { id: "lady_hardinge", name: "Lady Hardinge Medical College & Hospital", type: "hospital", lat: 28.6340, lon: 77.2140, icon: "🏥" },
  { id: "safdarjung_hospital", name: "Safdarjung Hospital Emergency", type: "hospital", lat: 28.5685, lon: 77.2060, icon: "🏥" },
  { id: "max_hospital_saket", name: "Max Super Speciality Hospital Saket", type: "hospital", lat: 28.5270, lon: 77.2140, icon: "🏥" },
  { id: "lnjp_hospital", name: "Lok Nayak (LNJP) Hospital", type: "hospital", lat: 28.6360, lon: 77.2400, icon: "🏥" },
  { id: "gb_pant_hospital", name: "GB Pant Hospital", type: "hospital", lat: 28.6370, lon: 77.2380, icon: "🏥" },
  { id: "ganga_ram_hospital", name: "Sir Ganga Ram Hospital", type: "hospital", lat: 28.6390, lon: 77.1890, icon: "🏥" },
  { id: "st_stephens_hospital", name: "St. Stephen's Hospital Tis Hazari", type: "hospital", lat: 28.6660, lon: 77.2180, icon: "🏥" },
  { id: "holy_family_hospital", name: "Holy Family Hospital Okhla", type: "hospital", lat: 28.5600, lon: 77.2750, icon: "🏥" },
  { id: "batra_hospital", name: "Batra Hospital Tughlakabad", type: "hospital", lat: 28.5140, lon: 77.2450, icon: "🏥" },
  { id: "fortis_escorts", name: "Fortis Escorts Heart Institute Okhla", type: "hospital", lat: 28.5580, lon: 77.2770, icon: "🏥" },
  { id: "moolchand_hospital", name: "Moolchand Medcity Lajpat Nagar", type: "hospital", lat: 28.5660, lon: 77.2370, icon: "🏥" },
  { id: "saket_city_hospital", name: "Smart Super Speciality Saket", type: "hospital", lat: 28.5285, lon: 77.2160, icon: "🏥" },
  { id: "max_patparganj", name: "Max Super Speciality Hospital Patparganj", type: "hospital", lat: 28.6290, lon: 77.3080, icon: "🏥" }
];

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

with open(frontend_ts_path, "w", encoding="utf-8") as f:
    f.write(ts_content)

print(f"Synchronized {len(nodes)} nodes, {len(edges)} edges, {len(potholes)} potholes -> {frontend_ts_path}")
