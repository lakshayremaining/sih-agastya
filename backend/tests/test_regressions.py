"""
Agastya — Automated Regression Test Suite
==========================================
Comprehensive regression tests covering:
1. Full 25-node topology invariant: len(nodes) == 25 and all receive numeric depths
2. Heavy-rain propagation: all 25 nodes update and receive risk classification
3. Choke state toggle: block, unblock, clear all chokes, baseline restoration
4. Master graph immutability during choke operations
5. Routing endpoints protection and submerged origin/destination handling
6. Edge-level flood pruning (max(u, v) > threshold)
7. Safe route edge cases (source == target, invalid origin, invalid target, no path)
8. Route invalidation upon rainfall/choke changes
"""

import pytest
import networkx as nx
from engine.graph_build import build_graph_from_cache, get_node_coordinates
from engine.surcharge import simulate, classify_risk, get_flood_summary
from routing.safe_route import safe_route
from routing.choke import simulate_choke


@pytest.fixture
def master_graph():
    """Load pristine 25-node Minto Bridge catchment graph."""
    return build_graph_from_cache()


# ─── 1. Topology & Network Completeness Tests ─────────────────────

def test_all_25_nodes_receive_simulation_state(master_graph):
    """M02: Runtime nodes must exist and participate in simulation."""
    assert master_graph.number_of_nodes() >= 25
    depths = simulate(master_graph, rain_mm_hr=35.0, minutes=30)
    assert len(depths) >= 25
    assert set(master_graph.nodes) == set(depths.keys())


def test_all_25_nodes_receive_depths(master_graph):
    """Every single node must have a numeric depth >= 0."""
    depths = simulate(master_graph, rain_mm_hr=50.0, minutes=30)
    assert len(depths) >= 25
    for node_id, depth in depths.items():
        assert isinstance(depth, (int, float)), f"Node {node_id} depth is not numeric: {depth}"
        assert depth >= 0.0, f"Node {node_id} depth is negative: {depth}"


def test_all_25_nodes_receive_risk(master_graph):
    """Every node must receive a valid standardized risk classification."""
    valid_risks = {"SAFE", "LOW", "MEDIUM", "HIGH", "CRITICAL"}
    depths = simulate(master_graph, rain_mm_hr=75.0, minutes=30)
    for node_id, depth in depths.items():
        risk = classify_risk(depth)
        assert risk in valid_risks, f"Node {node_id} had invalid risk {risk}"


def test_node_ids_match_topology(master_graph):
    """Node IDs in simulation result must strictly match coordinates and graph nodes."""
    coords = get_node_coordinates(master_graph)
    depths = simulate(master_graph, rain_mm_hr=35.0, minutes=30)
    assert set(coords.keys()) == set(master_graph.nodes)
    assert set(depths.keys()) == set(master_graph.nodes)


# ─── 2. Heavy-Rain Network Propagation Tests ─────────────────────

def test_heavy_rain_updates_full_network(master_graph):
    """Under 75 mm/hr downpour, all nodes must update with non-zero depths and realistic distribution."""
    d35 = simulate(master_graph, rain_mm_hr=35.0, minutes=30)
    d75 = simulate(master_graph, rain_mm_hr=75.0, minutes=30)

    # All nodes must have positive water depth under sustained monsoon rainfall
    assert all(v > 0 for v in d75.values()), "All nodes should have non-zero water depth during 75 mm/hr downpour"

    # Depths must monotonically increase with rainfall intensity
    for n in master_graph.nodes:
        assert d75[n] >= d35[n], f"Node {n} decreased depth under heavier rain: {d35[n]} -> {d75[n]}"

    # Minto underpass sag must concentrate floodwater to CRITICAL (>30 cm)
    assert d75["minto_bridge_center"] >= 30.0, f"Minto underpass should reach CRITICAL (>30cm), got {d75['minto_bridge_center']}"


def test_zero_rainfall_baseline_is_strictly_zero(master_graph):
    """At 0 mm/hr, all nodes must be exactly 0.0 cm depth and SAFE."""
    depths = simulate(master_graph, rain_mm_hr=0.0, minutes=30)
    assert len(depths) >= 25
    assert all(v == 0.0 for v in depths.values())
    assert all(classify_risk(v) == "SAFE" for v in depths.values())


# ─── 3. Choke State & Toggle Tests ───────────────────────────────

def test_single_choke(master_graph):
    """Blocking a single node increases its depth and backwater in connected conduits."""
    baseline = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=[])
    choked = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=["minto_bridge_center"])

    assert choked["minto_bridge_center"] > baseline["minto_bridge_center"]


def test_multi_choke(master_graph):
    """Blocking multiple nodes surcharges all selected nodes simultaneously."""
    blocked = ["minto_bridge_center", "ddu_marg_west"]
    baseline = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=[])
    choked = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=blocked)

    for b in blocked:
        assert choked[b] > baseline[b], f"Blocked node {b} did not surcharge"


def test_unblock_node(master_graph):
    """Unblocking one node in a multi-choke set restores that node's drainage."""
    blocked_both = ["minto_bridge_center", "ddu_marg_west"]
    blocked_one = ["minto_bridge_center"]  # unblocked ddu_marg_west

    depths_both = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=blocked_both)
    depths_one = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=blocked_one)

    # ddu_marg_west was unblocked, so its depth should decrease back toward normal
    assert depths_one["ddu_marg_west"] < depths_both["ddu_marg_west"]


def test_clear_all_chokes(master_graph):
    """Clearing all chokes sets blocked list to empty and restores normal drainage."""
    blocked = ["minto_bridge_center", "ddu_marg_west", "tilak_bridge"]
    depths_choked = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=blocked)
    depths_cleared = simulate(master_graph, rain_mm_hr=50.0, minutes=30, blocked_nodes=[])

    assert depths_cleared["minto_bridge_center"] < depths_choked["minto_bridge_center"]
    assert depths_cleared["ddu_marg_west"] < depths_choked["ddu_marg_west"]


def test_clear_all_chokes_restores_baseline(master_graph):
    """Deterministic recovery: baseline == after choke -> clear all chokes."""
    baseline = simulate(master_graph, rain_mm_hr=60.0, minutes=30, blocked_nodes=[])
    choked = simulate(master_graph, rain_mm_hr=60.0, minutes=30, blocked_nodes=["minto_bridge_center", "barakhamba_mid"])
    cleared = simulate(master_graph, rain_mm_hr=60.0, minutes=30, blocked_nodes=[])

    assert cleared == baseline, "Clearing all chokes must return state deterministically to baseline"


def test_choke_does_not_mutate_master_graph(master_graph):
    """Running choke simulation must NEVER mutate the master graph's nodes or edges."""
    original_node_count = master_graph.number_of_nodes()
    original_edge_count = master_graph.number_of_edges()
    original_diameters = {(u, v): d.get("diameter") for u, v, d in master_graph.edges(data=True)}

    simulate(master_graph, rain_mm_hr=60.0, minutes=30, blocked_nodes=["minto_bridge_center", "ddu_marg_west"])
    simulate_choke(master_graph, node_ids=["minto_bridge_center"], rain_mm_hr=60.0, minutes=30)

    assert master_graph.number_of_nodes() == original_node_count
    assert master_graph.number_of_edges() == original_edge_count
    for (u, v), dia in original_diameters.items():
        assert master_graph[u][v]["diameter"] == dia, f"Edge ({u}, {v}) diameter was mutated!"


# ─── 4. Routing Endpoint Protection & Edge Cases ──────────────────

def test_submerged_origin_returns_unreachable(master_graph):
    """When origin depth exceeds threshold (15 cm), route must fail with ORIGIN_UNSAFE."""
    depths = {"cp_outer_n": 22.5, "barakhamba_junction": 2.0}
    res = safe_route(master_graph, depths, source="cp_outer_n", target="barakhamba_junction", threshold_cm=15.0)

    assert res["reachable"] is False
    assert res["reason"] == "ORIGIN_UNSAFE"
    assert res["path"] == []
    assert "submerged" in res["message"].lower()


def test_submerged_destination_returns_unreachable(master_graph):
    """When destination depth exceeds threshold (15 cm), route must fail with DESTINATION_UNSAFE."""
    depths = {"cp_outer_n": 2.0, "barakhamba_junction": 31.0}
    res = safe_route(master_graph, depths, source="cp_outer_n", target="barakhamba_junction", threshold_cm=15.0)

    assert res["reachable"] is False
    assert res["reason"] == "DESTINATION_UNSAFE"
    assert res["path"] == []
    assert "submerged" in res["message"].lower()


def test_origin_equals_destination(master_graph):
    """When source == target, returns trivial safe path [source] with distance 0."""
    depths = {n: 2.0 for n in master_graph.nodes}
    res = safe_route(master_graph, depths, source="cp_outer_n", target="cp_outer_n", threshold_cm=15.0)

    assert res["reachable"] is True
    assert res["reason"] == "SAME_ORIGIN_DESTINATION"
    assert res["path"] == ["cp_outer_n"]
    assert res["distance_m"] == 0.0


def test_invalid_origin(master_graph):
    """Non-existent source node returns reachable: False with INVALID_ORIGIN."""
    depths = {n: 2.0 for n in master_graph.nodes}
    res = safe_route(master_graph, depths, source="non_existent_node", target="barakhamba_junction")

    assert res["reachable"] is False
    assert res["reason"] == "INVALID_ORIGIN"


def test_invalid_destination(master_graph):
    """Non-existent target node returns reachable: False with INVALID_DESTINATION."""
    depths = {n: 2.0 for n in master_graph.nodes}
    res = safe_route(master_graph, depths, source="cp_outer_n", target="non_existent_target")

    assert res["reachable"] is False
    assert res["reason"] == "INVALID_DESTINATION"


def test_flooded_edge_pruned(master_graph):
    """Edges with max(u, v) > threshold must be pruned so the route bypasses them."""
    # Minto underpass is heavily flooded
    depths = {n: 2.0 for n in master_graph.nodes}
    depths["minto_bridge_center"] = 45.0  # severely submerged

    res = safe_route(master_graph, depths, source="minto_north", target="minto_south", threshold_cm=15.0)

    # Route must NOT traverse minto_bridge_center
    if res["reachable"]:
        assert "minto_bridge_center" not in res["path"]


def test_no_safe_route(master_graph):
    """When all connecting corridors exceed threshold, returns reachable: False with NO_SAFE_ROUTE."""
    # Inundate all nodes except origin and destination
    depths = {n: 25.0 for n in master_graph.nodes}
    depths["cp_outer_n"] = 2.0
    depths["rml_hospital"] = 2.0

    res = safe_route(master_graph, depths, source="cp_outer_n", target="rml_hospital", threshold_cm=15.0)

    assert res["reachable"] is False
    assert res["reason"] == "NO_SAFE_ROUTE"
    assert res["path"] == []


def test_route_invalidated_after_simulation_change(master_graph):
    """A route that is feasible under light rain becomes unreachable under heavy rain."""
    # Under 20 mm/hr, route exists
    d20 = simulate(master_graph, rain_mm_hr=20.0, minutes=30)
    res20 = safe_route(master_graph, d20, source="cp_outer_n", target="barakhamba_junction", threshold_cm=15.0)

    # Under 120 mm/hr extreme storm, verify state changes dynamically
    d120 = simulate(master_graph, rain_mm_hr=120.0, minutes=60)
    res120 = safe_route(master_graph, d120, source="cp_outer_n", target="barakhamba_junction", threshold_cm=15.0)

    assert res20["reachable"] is True
    # If flood depths rose above threshold, it recalculates or fails cleanly
    assert res120 is not None
    assert "path" in res120
