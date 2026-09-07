"""
Agastya — Safe Ambulance Route: Dijkstra with Flooded Node Avoidance & In-Memory Memoization
=============================================================================================
Computes the shortest safe path for ambulances by removing
flooded nodes (depth > threshold) from the road graph and
running Dijkstra's shortest path algorithm.

Features:
- In-memory route memoization cache for ultra-fast O(1) response (<0.1ms).
- Baseline all-pairs shortest paths cache.
- Multi-destination pre-warming.
"""

import networkx as nx
from typing import Optional

# Global in-memory route cache: key -> RouteResponse dict
_ROUTE_CACHE: dict[tuple, dict] = {}
_MAX_CACHE_SIZE = 50000

# Pre-computed all-pairs baseline shortest paths cache: (source, target) -> (path, distance)
_BASELINE_ALL_PAIRS_CACHE: dict[tuple[str, str], tuple[list[str], float]] = {}


def _get_cache_key(
    source: str,
    target: str,
    threshold_cm: float,
    depth_cm: dict[str, float]
) -> tuple:
    """Build a deterministic hashable cache key from route request and flood depth state."""
    # Round depths to 1 decimal place and only include flooded/non-zero nodes for compact key
    flooded_items = tuple(
        sorted((k, round(v, 1)) for k, v in depth_cm.items() if v > 0.0)
    )
    return (source, target, round(threshold_cm, 1), flooded_items)


def clear_route_cache():
    """Clear in-memory route cache."""
    _ROUTE_CACHE.clear()


def is_arterial_node(node_id: str) -> bool:
    """Check if node belongs to primary arterial road network (not unclassified mesh alley)."""
    nid = str(node_id).lower()
    return not (nid.startswith("mesh_") or "_wp" in nid)


def get_routing_cost(road_G: nx.Graph, u: str, v: str, depth_cm: Optional[dict[str, float]] = None) -> float:
    """
    Calculate emergency routing cost with arterial road hierarchy prioritization.
    Prioritizes wide, clean multi-lane main roads over narrow back-alleys,
    and applies progressive pooling penalties.
    """
    edge_data = road_G.get_edge_data(u, v) or {}
    length = float(edge_data.get("length", 100.0))

    # Arterial hierarchy preference
    is_main_arterial = is_arterial_node(u) and is_arterial_node(v)
    if is_main_arterial:
        hierarchy_factor = 0.65  # Preferred primary emergency corridor (CP, Barakhamba, KG Marg, Janpath, Tolstoy, DDU)
    elif is_arterial_node(u) or is_arterial_node(v):
        hierarchy_factor = 1.0   # Secondary connector
    else:
        hierarchy_factor = 2.5   # Narrow alley / mesh shortcut penalty

    # Water pooling safety penalty (even under 15cm threshold)
    water_factor = 1.0
    if depth_cm:
        u_d = depth_cm.get(str(u), 0.0)
        v_d = depth_cm.get(str(v), 0.0)
        edge_depth = max(u_d, v_d)
        water_factor = 1.0 + (edge_depth / 15.0) * 0.5

    return length * hierarchy_factor * water_factor


def prewarm_baseline_all_pairs(road_G: nx.Graph):
    """Pre-compute unconstrained baseline shortest paths for key hospital hubs on graph startup."""
    global _BASELINE_ALL_PAIRS_CACHE
    try:
        # Assign baseline routing costs
        for u, v in road_G.edges():
            road_G[u][v]["baseline_cost"] = get_routing_cost(road_G, u, v)

        hospital_nodes = [n for n, d in road_G.nodes(data=True) if d.get("role") == "hospital" or "hospital" in n or "aiims" in n or "rml" in n or "lnjp" in n]
        for h in hospital_nodes:
            if h in road_G:
                paths = nx.single_source_dijkstra_path(road_G, h, weight="baseline_cost")
                for u in paths:
                    path_u_to_h = [str(n) for n in reversed(paths[u])]
                    dist_u_to_h = sum(road_G[path_u_to_h[i]][path_u_to_h[i+1]].get("length", 100.0) for i in range(len(path_u_to_h)-1)) if len(path_u_to_h) > 1 else 0.0
                    _BASELINE_ALL_PAIRS_CACHE[(str(u), str(h))] = (path_u_to_h, float(dist_u_to_h))

                    path_h_to_u = [str(n) for n in paths[u]]
                    dist_h_to_u = sum(road_G[path_h_to_u[i]][path_h_to_u[i+1]].get("length", 100.0) for i in range(len(path_h_to_u)-1)) if len(path_h_to_u) > 1 else 0.0
                    _BASELINE_ALL_PAIRS_CACHE[(str(h), str(u))] = (path_h_to_u, float(dist_h_to_u))
    except Exception as e:
        print(f"[Agastya SafeRoute] Baseline prewarm warning: {e}")


def compute_alternate_routes(
    road_G: nx.Graph,
    depth_cm: dict[str, float],
    source: str,
    target: str,
    safe_path: list[str],
    normal_path: list[str],
    threshold_cm: float = 15.0
) -> list[dict]:
    """
    Computes candidate alternative routes (such as direct unconstrained path or alternative arterial)
    and calculates their predicted flood depth, inundation level, and rejection reasons.
    """
    alternates = []

    # Candidate 1: Direct unconstrained shortest path
    if normal_path and len(normal_path) > 1:
        norm_depths = [depth_cm.get(str(n), 0.0) for n in normal_path]
        max_d = max(norm_depths) if norm_depths else 0.0
        avg_d = (sum(norm_depths) / len(norm_depths)) if norm_depths else 0.0
        flooded = [str(n) for n in normal_path if depth_cm.get(str(n), 0.0) > threshold_cm]

        dist = 0.0
        for i in range(len(normal_path) - 1):
            u, v = normal_path[i], normal_path[i+1]
            if road_G.has_edge(u, v):
                dist += road_G[u][v].get("length", 100.0)

        if max_d > 30.0:
            status = "INUNDATED_CRITICAL"
            reason = f"AI Rejected: Critical submergence ({max_d:.1f} cm water). Severe risk of engine stalling."
        elif max_d > threshold_cm:
            status = "SUBMERGED_UNSAFE"
            reason = f"AI Rejected: Water level ({max_d:.1f} cm) exceeds {threshold_cm:.0f} cm safe vehicle clearance."
        elif max_d > 5.0:
            status = "HIGH_WATER_RISK"
            reason = f"Notice: Moderate surface pooling ({max_d:.1f} cm water). Passable with reduced speed."
        else:
            status = "PASSABLE_CLEAR"
            reason = "Direct shortest corridor clear of water."

        # Include if normal_path is different from safe_path or if it has water > 0
        if normal_path != safe_path or max_d > 0.0:
            alternates.append({
                "id": "alt_direct",
                "name": "Direct Shortest Corridor (Unconstrained)",
                "path": [str(n) for n in normal_path],
                "distance_m": round(dist, 1),
                "max_depth_cm": round(max_d, 1),
                "avg_depth_cm": round(avg_d, 1),
                "flooded_nodes_count": len(flooded),
                "flooded_nodes": flooded,
                "status": status,
                "is_safe": max_d <= threshold_cm,
                "reason_rejected": reason,
            })

    # Candidate 2: Alternative Arterial Corridor (secondary route)
    reference_path = normal_path if normal_path else safe_path
    if reference_path and len(reference_path) > 4:
        removed_edges = []
        mid = len(reference_path) // 2
        for i in range(max(1, mid - 2), min(len(reference_path) - 2, mid + 3)):
            u, v = reference_path[i], reference_path[i+1]
            if road_G.has_edge(u, v):
                edge_data = road_G.get_edge_data(u, v)
                road_G.remove_edge(u, v)
                removed_edges.append((u, v, edge_data))

        try:
            alt2_path_nodes = nx.shortest_path(road_G, source, target, weight="length")
            alt2_path = [str(n) for n in alt2_path_nodes]

            if alt2_path != normal_path and alt2_path != safe_path:
                alt2_depths = [depth_cm.get(str(n), 0.0) for n in alt2_path]
                alt2_max_d = max(alt2_depths) if alt2_depths else 0.0
                alt2_avg_d = (sum(alt2_depths) / len(alt2_depths)) if alt2_depths else 0.0
                alt2_flooded = [str(n) for n in alt2_path if depth_cm.get(str(n), 0.0) > threshold_cm]

                alt2_dist = 0.0
                for i in range(len(alt2_path) - 1):
                    u, v = alt2_path[i], alt2_path[i+1]
                    if road_G.has_edge(u, v):
                        alt2_dist += road_G[u][v].get("length", 100.0)

                if alt2_max_d > 30.0:
                    alt2_status = "INUNDATED_CRITICAL"
                    alt2_reason = f"AI Rejected: Inundation peak {alt2_max_d:.1f} cm exceeds vehicle limit."
                elif alt2_max_d > threshold_cm:
                    alt2_status = "SUBMERGED_UNSAFE"
                    alt2_reason = f"AI Rejected: Submerged with {alt2_max_d:.1f} cm water at {len(alt2_flooded)} points."
                else:
                    alt2_status = "PASSABLE_CLEAR"
                    alt2_reason = "Alternate route passable but longer than optimal safe route."

                alternates.append({
                    "id": "alt_arterial",
                    "name": "Secondary Arterial Bypass",
                    "path": alt2_path,
                    "distance_m": round(alt2_dist, 1),
                    "max_depth_cm": round(alt2_max_d, 1),
                    "avg_depth_cm": round(alt2_avg_d, 1),
                    "flooded_nodes_count": len(alt2_flooded),
                    "flooded_nodes": alt2_flooded,
                    "status": alt2_status,
                    "is_safe": alt2_max_d <= threshold_cm,
                    "reason_rejected": alt2_reason,
                })
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            pass
        finally:
            for u, v, d in removed_edges:
                if d:
                    road_G.add_edge(u, v, **d)
                else:
                    road_G.add_edge(u, v)

    return alternates


def safe_route(
    road_G: nx.Graph,
    depth_cm: dict[str, float],
    source: str,
    target: str,
    threshold_cm: float = 15.0,
    use_cache: bool = True,
) -> dict:
    """
    Find the shortest safe route avoiding flooded areas with in-memory caching.

    Args:
        road_G: NetworkX graph of the road network.
        depth_cm: Dict mapping node_id -> flood depth in cm.
        source: Start node ID.
        target: Destination node ID.
        threshold_cm: Maximum safe water depth in cm (default 15.0 cm).
        use_cache: Whether to use in-memory memoization cache.

    Returns:
        Dict with reachable, reason, path, distance_m, blocked_nodes,
        blocked_count, eta_normal_sec, eta_safe_sec, eta_sec, eta_saved_sec,
        detour_delay_sec, detour_extra_m, detour_m, avoided_segments, message.
    """
    source = str(source)
    target = str(target)

    # 1. Check in-memory route cache for instant O(1) hit
    cache_key = None
    if use_cache:
        cache_key = _get_cache_key(source, target, threshold_cm, depth_cm)
        if cache_key in _ROUTE_CACHE:
            cached = _ROUTE_CACHE[cache_key].copy()
            cached["cached"] = True
            return cached

    # Check 1: Invalid source node
    if source not in road_G.nodes:
        res = {
            "path": [],
            "distance_m": 0.0,
            "blocked_nodes": [],
            "blocked_count": 0,
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": 0,
            "reachable": False,
            "reason": "INVALID_ORIGIN",
            "origin_depth_cm": None,
            "destination_depth_cm": depth_cm.get(target) if target in depth_cm else None,
            "threshold_cm": threshold_cm,
            "message": f"Origin node '{source}' does not exist in the catchment network.",
            "cached": False,
        }
        return res

    # Check 2: Invalid target node
    if target not in road_G.nodes:
        res = {
            "path": [],
            "distance_m": 0.0,
            "blocked_nodes": [],
            "blocked_count": 0,
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": 0,
            "reachable": False,
            "reason": "INVALID_DESTINATION",
            "origin_depth_cm": depth_cm.get(source) if source in depth_cm else None,
            "destination_depth_cm": None,
            "threshold_cm": threshold_cm,
            "message": f"Destination node '{target}' does not exist in the catchment network.",
            "cached": False,
        }
        return res

    # Check 3: Depth availability validation
    if source not in depth_cm or target not in depth_cm:
        missing = []
        if source not in depth_cm:
            missing.append(f"origin '{source}'")
        if target not in depth_cm:
            missing.append(f"destination '{target}'")
        res = {
            "path": [],
            "distance_m": 0.0,
            "blocked_nodes": [],
            "blocked_count": 0,
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": 0,
            "reachable": False,
            "reason": "ENDPOINT_DEPTH_UNAVAILABLE",
            "origin_depth_cm": depth_cm.get(source),
            "destination_depth_cm": depth_cm.get(target),
            "threshold_cm": threshold_cm,
            "message": f"Simulation depth unavailable for {', '.join(missing)} in current simulation state.",
            "cached": False,
        }
        return res

    source_depth = float(depth_cm[source])
    target_depth = float(depth_cm[target])

    # Check 4: Origin flood safety clearance
    if source_depth > threshold_cm:
        res = {
            "path": [],
            "distance_m": 0.0,
            "blocked_nodes": [source],
            "blocked_count": 1,
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": 1,
            "reachable": False,
            "reason": "ORIGIN_UNSAFE",
            "origin_depth_cm": round(source_depth, 1),
            "destination_depth_cm": round(target_depth, 1),
            "threshold_cm": threshold_cm,
            "message": (
                f"Dispatch origin '{source}' is submerged ({source_depth:.1f} cm > {threshold_cm:.0f} cm threshold). "
                f"Ambulance cannot safely deploy from this location."
            ),
            "cached": False,
        }
        if use_cache and cache_key:
            _ROUTE_CACHE[cache_key] = res
        return res

    # Check 5: Destination flood safety clearance
    if target_depth > threshold_cm:
        res = {
            "path": [],
            "distance_m": 0.0,
            "blocked_nodes": [target],
            "blocked_count": 1,
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": 1,
            "reachable": False,
            "reason": "DESTINATION_UNSAFE",
            "origin_depth_cm": round(source_depth, 1),
            "destination_depth_cm": round(target_depth, 1),
            "threshold_cm": threshold_cm,
            "message": (
                f"Destination '{target}' is submerged ({target_depth:.1f} cm > {threshold_cm:.0f} cm threshold). "
                f"Emergency facility/exit is currently inaccessible."
            ),
            "cached": False,
        }
        if use_cache and cache_key:
            _ROUTE_CACHE[cache_key] = res
        return res

    # Check 6: Source equals target
    if source == target:
        res = {
            "path": [source],
            "distance_m": 0.0,
            "blocked_nodes": [],
            "blocked_count": 0,
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": 0,
            "reachable": True,
            "reason": "SAME_ORIGIN_DESTINATION",
            "origin_depth_cm": round(source_depth, 1),
            "destination_depth_cm": round(target_depth, 1),
            "threshold_cm": threshold_cm,
            "message": "Origin and destination are identical.",
            "cached": False,
        }
        if use_cache and cache_key:
            _ROUTE_CACHE[cache_key] = res
        return res

    # Normal baseline route (from pre-warmed cache or NetworkX)
    pair_key = (source, target)
    if pair_key in _BASELINE_ALL_PAIRS_CACHE:
        normal_path, normal_distance = _BASELINE_ALL_PAIRS_CACHE[pair_key]
        normal_max_depth = max([depth_cm.get(str(n), 0.0) for n in normal_path], default=0.0)
    else:
        try:
            for u, v in road_G.edges():
                road_G[u][v]["baseline_cost"] = get_routing_cost(road_G, u, v)
            raw_normal_path = nx.shortest_path(road_G, source, target, weight="baseline_cost")
            normal_path = [str(n) for n in raw_normal_path]
            normal_distance = sum(road_G[normal_path[i]][normal_path[i+1]].get("length", 100.0) for i in range(len(normal_path)-1)) if len(normal_path) > 1 else 0.0
            normal_max_depth = max([depth_cm.get(str(n), 0.0) for n in normal_path], default=0.0)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            normal_path = []
            normal_distance = 0.0
            normal_max_depth = 0.0

    # Build safe subgraph: clone baseline road network
    G = road_G.copy()

    # Identify and remove flooded intermediate nodes
    blocked_nodes = []
    for n, d in depth_cm.items():
        if d > threshold_cm and n in G.nodes:
            if n != source and n != target:
                blocked_nodes.append(str(n))
                G.remove_node(n)

    # Edge-level safety: remove road segments where either endpoint is inundated
    pruned_edges = []
    edges_to_remove = []
    for u, v in G.edges():
        u_d = depth_cm.get(str(u), 0.0)
        v_d = depth_cm.get(str(v), 0.0)
        edge_depth = max(u_d, v_d)
        if edge_depth > threshold_cm:
            edges_to_remove.append((u, v))
            pruned_edges.append((str(u), str(v)))

    for u, v in edges_to_remove:
        if G.has_edge(u, v):
            G.remove_edge(u, v)

    try:
        # Dijkstra path on safe subgraph using arterial hierarchy routing cost
        for u, v in G.edges():
            G[u][v]["routing_cost"] = get_routing_cost(G, u, v, depth_cm)
        raw_safe_path = nx.shortest_path(G, source, target, weight="routing_cost")
        safe_path = [str(n) for n in raw_safe_path]
        safe_distance = sum(G[safe_path[i]][safe_path[i+1]].get("length", 100.0) for i in range(len(safe_path)-1)) if len(safe_path) > 1 else 0.0
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        res = {
            "path": [],
            "normal_path": normal_path,
            "distance_m": 0.0,
            "normal_distance_m": round(normal_distance, 1),
            "safe_distance_m": 0.0,
            "normal_max_depth_cm": round(normal_max_depth, 1),
            "safe_max_depth_cm": 0.0,
            "is_rerouted": False,
            "blocked_nodes": blocked_nodes,
            "blocked_count": len(blocked_nodes),
            "eta_normal_sec": 0.0,
            "eta_safe_sec": 0.0,
            "eta_sec": 0.0,
            "eta_saved_sec": 0.0,
            "detour_delay_sec": 0.0,
            "detour_extra_m": 0.0,
            "detour_m": 0.0,
            "avoided_segments": len(blocked_nodes) + len(pruned_edges),
            "reachable": False,
            "reason": "NO_SAFE_ROUTE",
            "origin_depth_cm": round(source_depth, 1),
            "destination_depth_cm": round(target_depth, 1),
            "threshold_cm": threshold_cm,
            "message": (
                f"No safe route found from {source} to {target}. "
                f"All connecting road corridors exceed vehicle water clearance ({threshold_cm:.0f} cm)."
            ),
            "cached": False,
        }
        if use_cache and cache_key:
            if len(_ROUTE_CACHE) >= _MAX_CACHE_SIZE:
                _ROUTE_CACHE.pop(next(iter(_ROUTE_CACHE)))
            _ROUTE_CACHE[cache_key] = res
        return res

    # Vehicle drive speed (urban Delhi ambulance avg ~30 km/h = ~8.33 m/s)
    speed_mps = 30.0 * 1000.0 / 3600.0
    eta_normal = (normal_distance / speed_mps) if normal_distance > 0 else (safe_distance / speed_mps)
    eta_safe = safe_distance / speed_mps
    detour_delay = max(0.0, eta_safe - eta_normal)
    detour_extra = max(0.0, safe_distance - normal_distance) if normal_distance > 0 else 0.0

    safe_path_str = [str(n) for n in safe_path]
    safe_max_depth = max([depth_cm.get(str(n), 0.0) for n in safe_path_str], default=0.0)
    is_rerouted = (normal_path != safe_path_str) and (normal_max_depth > threshold_cm or len(blocked_nodes) > 0)
    alternate_routes = compute_alternate_routes(road_G, depth_cm, source, target, safe_path_str, normal_path, threshold_cm)

    res = {
        "path": safe_path_str,
        "normal_path": normal_path,
        "distance_m": round(safe_distance, 1),
        "normal_distance_m": round(normal_distance, 1),
        "safe_distance_m": round(safe_distance, 1),
        "normal_max_depth_cm": round(normal_max_depth, 1),
        "safe_max_depth_cm": round(safe_max_depth, 1),
        "is_rerouted": is_rerouted,
        "blocked_nodes": blocked_nodes,
        "blocked_count": len(blocked_nodes),
        "eta_normal_sec": round(eta_normal, 1),
        "eta_safe_sec": round(eta_safe, 1),
        "eta_sec": round(eta_safe, 1),
        "eta_saved_sec": round(detour_delay, 1),
        "detour_delay_sec": round(detour_delay, 1),
        "detour_extra_m": round(detour_extra, 1),
        "detour_m": round(detour_extra, 1),
        "avoided_segments": len(blocked_nodes) + len(pruned_edges),
        "alternate_routes": alternate_routes,
        "reachable": True,
        "reason": "ROUTE_FOUND",
        "origin_depth_cm": round(source_depth, 1),
        "destination_depth_cm": round(target_depth, 1),
        "threshold_cm": threshold_cm,
        "message": (
            f"Safe route computed ({safe_distance:.0f}m) avoiding {len(blocked_nodes)} inundated road segments "
            f"(clearance threshold {threshold_cm:.0f} cm)."
        ),
        "cached": False,
    }

    if use_cache and cache_key:
        if len(_ROUTE_CACHE) >= _MAX_CACHE_SIZE:
            _ROUTE_CACHE.pop(next(iter(_ROUTE_CACHE)))
        _ROUTE_CACHE[cache_key] = res

    return res


def warm_all_combinations(
    road_G: nx.Graph,
    depth_cm: dict[str, float],
    sources: list[str],
    targets: list[str],
    threshold_cm: float = 15.0,
):
    """
    Pre-compute and cache all (source, target) route combinations in memory.
    """
    for src in sources:
        for tgt in targets:
            if src in road_G.nodes and tgt in road_G.nodes:
                safe_route(road_G, depth_cm, src, tgt, threshold_cm, use_cache=True)


def get_all_routes_from(
    road_G: nx.Graph,
    depth_cm: dict[str, float],
    source: str,
    threshold_cm: float = 15.0,
) -> dict[str, dict]:
    """
    Compute safe routes from a source to all reachable hospitals/landmarks.
    """
    hospital_nodes = [
        "aiims_delhi",
        "safdarjung_hospital",
        "rml_hospital",
        "lnjp_hospital",
        "gb_pant_hospital",
        "ganga_ram_hospital",
        "lady_hardinge",
        "blkapoor_hospital",
        "max_hospital_saket",
        "moolchand_hospital",
        "fortis_escorts_okhla",
        "holy_family_hospital",
        "apollo_hospital_sarita_vihar",
        "gtb_hospital_shahdara",
        "max_hospital_patparganj",
    ]
    routes = {}
    for target in hospital_nodes:
        if target in road_G.nodes and target != source:
            routes[target] = safe_route(road_G, depth_cm, source, target, threshold_cm)
    return routes

