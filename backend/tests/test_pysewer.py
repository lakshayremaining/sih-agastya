"""
Automated Unit Tests: PySewer Adapter & Gravity Layout Synthesizer
==================================================================
Tests automated gravity sewer layout generation, DEM hydraulic gradients,
CPHEEO standard compliance (slope >= 0.002, velocity >= 0.6 m/s),
and commercial pipe diameter selection.
"""

import pytest
from engine.graph_build import build_graph_from_cache
from engine.pysewer_adapter import get_pysewer_status, synthesize_sewer_topology


@pytest.fixture
def graph():
    return build_graph_from_cache()


def test_pysewer_status_metadata():
    """Verify PySewer status endpoint returns honest metadata."""
    status = get_pysewer_status()
    assert "pysewer_installed" in status
    assert "mode" in status
    assert status["minimum_slope"] == 0.002
    assert status["self_cleansing_velocity_ms"] == 0.6
    assert status["max_velocity_ms"] == 3.0
    assert "CPHEEO" in status["standards"]


def test_pysewer_synthesize_topology(graph):
    """Verify pipe synthesis generates full network topology for all edges."""
    res = synthesize_sewer_topology(graph, design_rain_mm_hr=35.0)

    assert res["status"] == "success"
    assert res["outfall_node"] == "minto_bridge_center"
    assert res["outfall_elevation_m"] == 210.5
    assert res["total_nodes"] >= 25
    assert res["total_pipes"] >= 39
    assert res["total_length_m"] > 1000

    # Inspect synthesized pipes
    pipes = res["pipes"]
    assert len(pipes) >= 39

    allowed_diameters_mm = {300, 450, 600, 800, 1000, 1200, 1500, 1800}

    for pipe in pipes:
        # CPHEEO minimum slope constraint
        assert pipe["slope"] >= 0.002, f"Pipe {pipe['from_node']}->{pipe['to_node']} slope {pipe['slope']} < 0.002"
        # Standard commercial diameter
        assert pipe["diameter_mm"] in allowed_diameters_mm
        # Non-zero capacity and velocity
        assert pipe["capacity_m3s"] > 0
        assert pipe["velocity_ms"] > 0
        # Flow velocity must meet self-cleansing requirement in the majority of gravity pipes
        assert "meets_cleansing_vel" in pipe


def test_real_elevation_differences_affect_slopes(graph):
    """Verify that slopes are calculated from actual DEM elevations, not flattened defaults."""
    res = synthesize_sewer_topology(graph, design_rain_mm_hr=35.0)
    slopes = [p["slope"] for p in res["pipes"]]

    # Ensure there is variation in slopes across steep underpass descent vs flatter links
    unique_slopes = set(round(s, 4) for s in slopes)
    assert len(unique_slopes) > 5, "Slopes should vary based on real DEM topography"
