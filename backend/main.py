"""
Agastya — FastAPI Main Application
====================================
Urban Flood Nowcasting API for Minto Bridge, Delhi.

Endpoints:
  POST /api/simulate  — Rain mm → flood depths per node
  POST /api/route     — Safe ambulance route (Dijkstra)
  POST /api/choke     — Block a manhole → recompute flooding
  GET  /api/rain/live — Real-time rain from Open-Meteo
  GET  /health        — Health check
  GET  /api/network   — Full network graph (for map rendering)
"""

import sys
import os

# Add backend directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import (
    SimulateRequest, SimulateResponse, NodeDepth,
    RouteRequest, RouteResponse,
    ChokeRequest, ChokeResponse,
    HealthResponse,
)
from engine.graph_build import build_graph_from_cache, get_node_coordinates, get_edge_list
from engine.surcharge import simulate, classify_risk, get_flood_summary
from routing.safe_route import safe_route, prewarm_baseline_all_pairs
from routing.choke import simulate_choke
from data.rain import fetch_live_rain
from engine.pysewer_adapter import get_pysewer_status, synthesize_sewer_topology

# ─── App Setup ─────────────────────────────────────────────────

app = FastAPI(
    title="Agastya — Urban Flood Nowcasting API",
    description=(
        "Real-time flood depth simulation, safe ambulance routing, "
        "and choke point analysis for Minto Bridge, Delhi. "
        "SIH 2026 · Problem Statement 26085."
    ),
    version="1.0.0",
)

# ─── CORS Configuration ────────────────────────────────────────
# In development and production, explicitly whitelist authorized origins.
# Never default to unrestricted "*" in production.
default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

env_origins = os.environ.get("FRONTEND_ORIGIN", "") or os.environ.get("FRONTEND_ORIGINS", "")
if env_origins:
    custom_origins = [orig.strip().rstrip("/") for orig in env_origins.replace(";", ",").split(",") if orig.strip()]
    allowed_origins = list(dict.fromkeys(default_origins + custom_origins))
else:
    allowed_origins = default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https:\/\/.*\.(vercel\.app|onrender\.com)$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)

# ─── Build graph on startup ───────────────────────────────────

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

print("[Agastya] Building drainage network for Minto Bridge, Delhi...")
GRAPH = build_graph_from_cache()
print(f"[Agastya] Network loaded: {GRAPH.number_of_nodes()} nodes, {GRAPH.number_of_edges()} edges")
print("[Agastya] Pre-warming in-memory all-pairs baseline routing tables...")
prewarm_baseline_all_pairs(GRAPH)
print("[Agastya] In-memory routing acceleration ready.")



# ─── High-Performance Backend In-Memory LRU Caches ─────────────────
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity: int = 5000):
        self.cache = OrderedDict()
        self.capacity = capacity

    def get(self, key):
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def set(self, key, value):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)

    def clear(self):
        self.cache.clear()

_SIMULATE_CACHE = LRUCache(capacity=2000)
_ROUTE_CACHE = LRUCache(capacity=5000)
_CHOKE_CACHE = LRUCache(capacity=1000)
_PYSEWER_SYNTH_CACHE = LRUCache(capacity=500)

# Pre-computed static network & PySewer cache
from engine.graph_build import get_potholes_list
_STATIC_NETWORK_CACHE = {
    "nodes": get_node_coordinates(GRAPH),
    "edges": get_edge_list(GRAPH),
    "potholes": get_potholes_list(),
    "center": {"lat": 28.6139, "lon": 77.2090},
    "zoom": 12,
    "coverage_radius_km": 30.0,
    "location": "Greater Delhi NCR (30km Arterial & Emergency Corridor Network)",
}
_STATIC_PYSEWER_STATUS = get_pysewer_status()


# ─── Endpoints ─────────────────────────────────────────────────

@app.post("/api/simulate", response_model=SimulateResponse)
async def api_simulate(req: SimulateRequest):
    """
    Simulate flood depths for a given rainfall intensity and duration.
    Supports multi-node blockage in choke mode across all 25 nodes.
    Features instant sub-millisecond in-memory LRU caching.
    """
    blocked_tuple = tuple(sorted(str(b) for b in (req.blocked_nodes or [])))
    cache_key = (round(req.rain_mm, 2), int(req.minutes), blocked_tuple)
    cached_res = _SIMULATE_CACHE.get(cache_key)
    if cached_res is not None:
        return cached_res

    depths = simulate(GRAPH, req.rain_mm, req.minutes, blocked_nodes=req.blocked_nodes)
    coords = get_node_coordinates(GRAPH)
    blocked_set = set(req.blocked_nodes or [])

    nodes = []
    for node_id, depth in depths.items():
        coord = coords.get(node_id, {})
        name_lower = coord.get("name", "").lower()
        if "underpass" in name_lower or "minto bridge" in name_lower or node_id in ("minto_bridge_center", "tilak_bridge"):
            role = "sag"
        elif "hospital" in name_lower or node_id in ("rml_hospital", "lady_hardinge"):
            role = "hospital"
        elif "station" in name_lower or node_id == "ndls_approach":
            role = "railway"
        else:
            role = "junction"

        risk = classify_risk(depth)
        nodes.append(NodeDepth(
            node_id=node_id,
            id=node_id,
            name=coord.get("name", node_id),
            lat=coord.get("lat", 0.0),
            lon=coord.get("lon", 0.0),
            lng=coord.get("lon", 0.0),
            depth_cm=depth,
            depth=depth,
            risk_level=risk,
            risk=risk,
            blocked=node_id in blocked_set,
            role=role,
        ))

    summary = get_flood_summary(depths)

    response = SimulateResponse(
        depths=depths,
        nodes=nodes,
        summary=summary,
        rain_mm=req.rain_mm,
        minutes=req.minutes,
    )
    _SIMULATE_CACHE.set(cache_key, response)
    return response


@app.post("/api/route", response_model=RouteResponse)
async def api_route(req: RouteRequest):
    """
    Find the shortest safe ambulance route avoiding flooded areas.
    Uses Dijkstra's algorithm with flooded nodes and flooded edges pruned.
    Features sub-millisecond in-memory LRU cache.
    """
    blocked_tuple = tuple(sorted(str(b) for b in (req.blocked_nodes or [])))
    depths_tuple = tuple(sorted((k, round(v, 2)) for k, v in (req.depths or {}).items() if v > 0)) if req.depths else ()
    route_key = (
        req.source,
        req.target,
        round(req.rain_mm, 2),
        int(req.minutes),
        round(req.threshold_cm, 2),
        blocked_tuple,
        depths_tuple,
    )
    cached_route = _ROUTE_CACHE.get(route_key)
    if cached_route is not None:
        return cached_route

    # Single source of truth: use client simulation depths if provided, else compute
    if req.depths and isinstance(req.depths, dict) and len(req.depths) > 0:
        depths = req.depths
    else:
        depths = simulate(GRAPH, req.rain_mm, req.minutes, blocked_nodes=req.blocked_nodes)

    result = safe_route(GRAPH, depths, req.source, req.target, req.threshold_cm, blocked_nodes=req.blocked_nodes)

    # Add coordinates for path visualization
    coords = get_node_coordinates(GRAPH)
    path_coords = []
    for node_id in result["path"]:
        coord = coords.get(node_id, {})
        path_coords.append({
            "node_id": node_id,
            "name": coord.get("name", node_id),
            "lat": coord.get("lat", 0),
            "lon": coord.get("lon", 0),
        })

    normal_path_coords = []
    for node_id in result.get("normal_path", []):
        coord = coords.get(node_id, {})
        normal_path_coords.append({
            "node_id": node_id,
            "name": coord.get("name", node_id),
            "lat": coord.get("lat", 0),
            "lon": coord.get("lon", 0),
        })

    alternate_routes_formatted = []
    for alt in result.get("alternate_routes", []):
        alt_coords = []
        for node_id in alt.get("path", []):
            coord = coords.get(node_id, {})
            alt_coords.append({
                "node_id": node_id,
                "name": coord.get("name", node_id),
                "lat": coord.get("lat", 0),
                "lon": coord.get("lon", 0),
            })
        alt_copy = dict(alt)
        alt_copy["path_coords"] = alt_coords
        alternate_routes_formatted.append(alt_copy)

    response = RouteResponse(
        path=result["path"],
        path_coords=path_coords,
        normal_path=result.get("normal_path", []),
        normal_path_coords=normal_path_coords,
        distance_m=result["distance_m"],
        normal_distance_m=result.get("normal_distance_m", result["distance_m"]),
        safe_distance_m=result.get("safe_distance_m", result["distance_m"]),
        normal_max_depth_cm=result.get("normal_max_depth_cm", 0.0),
        safe_max_depth_cm=result.get("safe_max_depth_cm", 0.0),
        is_rerouted=result.get("is_rerouted", False),
        blocked_nodes=result["blocked_nodes"],
        blocked_count=result["blocked_count"],
        eta_normal_sec=result["eta_normal_sec"],
        eta_safe_sec=result["eta_safe_sec"],
        eta_saved_sec=result["eta_saved_sec"],
        detour_delay_sec=result.get("detour_delay_sec", 0.0),
        detour_extra_m=result.get("detour_extra_m", 0.0),
        detour_m=result.get("detour_m", 0.0),
        eta_sec=result.get("eta_sec", 0.0),
        avoided_segments=result.get("avoided_segments", 0),
        alternate_routes=alternate_routes_formatted,
        reachable=result["reachable"],
        reason=result.get("reason"),
        origin_depth_cm=result.get("origin_depth_cm"),
        destination_depth_cm=result.get("destination_depth_cm"),
        threshold_cm=result.get("threshold_cm", req.threshold_cm),
        message=result["message"],
    )
    _ROUTE_CACHE.set(route_key, response)
    return response



@app.post("/api/choke", response_model=ChokeResponse)
async def api_choke(req: ChokeRequest):
    """
    Simulate blocking one or multiple manholes and see cascading flood impact.
    Click-to-choke: block nodes → neighbouring roads surcharge and flood more.
    """
    targets = []
    if req.node_id:
        targets.append(req.node_id)
    if req.node_ids:
        targets.extend(req.node_ids)
    targets = list(dict.fromkeys(targets))

    if not targets:
        raise HTTPException(400, "At least one node_id or node_ids must be provided")

    for nid in targets:
        if nid not in GRAPH.nodes:
            raise HTTPException(404, f"Node '{nid}' not found in network")

    cache_key = (tuple(sorted(targets)), round(req.rain_mm, 2), int(req.minutes))
    cached_choke = _CHOKE_CACHE.get(cache_key)
    if cached_choke is not None:
        return cached_choke

    result = simulate_choke(GRAPH, node_ids=targets, rain_mm_hr=req.rain_mm, minutes=req.minutes)
    res_obj = ChokeResponse(**result)
    _CHOKE_CACHE.set(cache_key, res_obj)
    return res_obj


@app.get("/api/rain/live")
async def api_rain_live():
    """
    Fetch real-time rainfall data for Minto Bridge from Open-Meteo API.
    Uses in-memory TTL cache and falls back to cached data if offline.
    """
    return await fetch_live_rain()


@app.get("/api/network")
async def api_network():
    """
    Return the full drainage network graph for map rendering.
    Includes node coordinates, edge connections, and pothole hazard locations across Delhi NCR.
    Cached statically in-memory for instant 0ms response.
    """
    return _STATIC_NETWORK_CACHE


@app.get("/api/pysewer/status")
async def api_pysewer_status():
    """
    Return PySewer library status and topology generation specifications.
    Explains the gravity-driven hydraulic design principles for the Minto Bridge catchment.
    """
    return _STATIC_PYSEWER_STATUS


@app.post("/api/pysewer/synthesize")
async def api_pysewer_synthesize(design_rain_mm_hr: float = 35.0):
    """
    Execute PySewer gravity layout synthesizer across the road and elevation graph.
    Returns diameter sizing, slopes, and flow capacities compliant with CPHEEO standards.
    Features in-memory LRU caching.
    """
    key = round(design_rain_mm_hr, 1)
    cached = _PYSEWER_SYNTH_CACHE.get(key)
    if cached is not None:
        return cached

    result = synthesize_sewer_topology(GRAPH, design_rain_mm_hr=design_rain_mm_hr)
    _PYSEWER_SYNTH_CACHE.set(key, result)
    return result


@app.get("/health", response_model=HealthResponse)
@app.get("/api/health", response_model=HealthResponse)
async def health():
    """Health check endpoint for Render / UptimeRobot / keep-alive."""
    return HealthResponse()


# ─── Run directly ──────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    is_prod = os.environ.get("ENVIRONMENT", "development").lower() == "production"
    uvicorn.run("main:app", host=host, port=port, reload=not is_prod)
