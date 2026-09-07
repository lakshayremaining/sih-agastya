"""
Agastya — Pydantic Schemas: Request/Response Models
====================================================
Defines all API request and response models for type safety
and automatic OpenAPI documentation.
"""

from pydantic import BaseModel, Field
from typing import Optional


# ─── Request Models ───────────────────────────────────────────

class SimulateRequest(BaseModel):
    """Request body for /api/simulate endpoint."""
    rain_mm: float = Field(
        default=50.0,
        ge=0, le=200,
        description="Rainfall intensity in mm/hr (0-200)",
    )
    minutes: int = Field(
        default=30,
        ge=5, le=360,
        description="Rain duration in minutes",
    )
    blocked_nodes: list[str] = Field(
        default=[],
        description="List of node IDs that are currently blocked/choked",
    )

class RouteRequest(BaseModel):
    """Request body for /api/route endpoint."""
    source: str = Field(
        description="Source node ID (e.g., 'minto_bridge_center')",
    )
    target: str = Field(
        description="Target node ID (e.g., 'rml_hospital')",
    )
    threshold_cm: float = Field(
        default=15.0,
        ge=0, le=100,
        description="Max safe water depth in cm. Roads deeper than this are avoided.",
    )
    rain_mm: float = Field(
        default=50.0,
        ge=0, le=200,
        description="Current rainfall intensity (to compute current flood depths)",
    )
    minutes: int = Field(
        default=30,
        ge=5, le=360,
        description="Rain duration in minutes",
    )
    blocked_nodes: list[str] = Field(
        default=[],
        description="List of choked node IDs",
    )
    depths: Optional[dict[str, float]] = Field(
        default=None,
        description="Optional pre-computed simulation depths currently displayed on frontend",
    )

class ChokeRequest(BaseModel):
    """Request body for /api/choke endpoint."""
    node_id: Optional[str] = Field(
        default=None,
        description="Single manhole node ID to block",
    )
    node_ids: list[str] = Field(
        default=[],
        description="List of all currently blocked manhole node IDs",
    )
    rain_mm: float = Field(
        default=50.0,
        ge=0, le=200,
        description="Current rainfall intensity",
    )
    minutes: int = Field(
        default=30,
        ge=5, le=360,
        description="Rain duration in minutes",
    )


# ─── Response Models ──────────────────────────────────────────

class NodeDepth(BaseModel):
    """Flood depth and risk state at a single node."""
    node_id: str
    id: Optional[str] = None
    name: str
    lat: float
    lon: float
    lng: Optional[float] = None
    depth_cm: float
    depth: Optional[float] = None
    risk_level: str
    risk: Optional[str] = None
    blocked: bool = False
    role: str = "junction"

    def __init__(self, **data):
        if "id" not in data and "node_id" in data:
            data["id"] = data["node_id"]
        if "lng" not in data and "lon" in data:
            data["lng"] = data["lon"]
        if "depth" not in data and "depth_cm" in data:
            data["depth"] = data["depth_cm"]
        if "risk" not in data and "risk_level" in data:
            data["risk"] = data["risk_level"]
        super().__init__(**data)

class SimulateResponse(BaseModel):
    """Response from /api/simulate."""
    depths: dict[str, float]
    nodes: list[NodeDepth]
    summary: dict
    rain_mm: float
    minutes: int

class AlternateRouteInfo(BaseModel):
    """Information about an alternative route considered by the routing engine."""
    id: str
    name: str
    path: list[str]
    path_coords: Optional[list[dict]] = []
    distance_m: float
    max_depth_cm: float
    avg_depth_cm: float
    flooded_nodes_count: int
    flooded_nodes: Optional[list[str]] = []
    status: str
    is_safe: bool
    reason_rejected: str

class RouteResponse(BaseModel):
    """Response from /api/route."""
    path: list[str]
    path_coords: list[dict]
    normal_path: Optional[list[str]] = []
    normal_path_coords: Optional[list[dict]] = []
    distance_m: float
    normal_distance_m: Optional[float] = 0.0
    safe_distance_m: Optional[float] = 0.0
    normal_max_depth_cm: Optional[float] = 0.0
    safe_max_depth_cm: Optional[float] = 0.0
    is_rerouted: Optional[bool] = False
    blocked_nodes: list[str]
    blocked_count: int
    eta_normal_sec: float
    eta_safe_sec: float
    eta_saved_sec: float
    detour_delay_sec: Optional[float] = 0.0
    detour_extra_m: Optional[float] = 0.0
    detour_m: Optional[float] = 0.0
    eta_sec: Optional[float] = 0.0
    avoided_segments: Optional[int] = 0
    alternate_routes: Optional[list[AlternateRouteInfo]] = []
    reachable: bool
    reason: Optional[str] = None
    origin_depth_cm: Optional[float] = None
    destination_depth_cm: Optional[float] = None
    threshold_cm: Optional[float] = 15.0
    message: str


class ChokeNeighbour(BaseModel):
    """Flood impact on a neighbour after choke."""
    node_id: str
    name: str
    depth_before_cm: float
    depth_after_cm: float
    depth_increase_cm: float
    lat: float
    lon: float

class ChokeResponse(BaseModel):
    """Response from /api/choke."""
    choked_node: str
    choked_name: str
    flooded_neighbours: list[ChokeNeighbour]
    depths_after: dict[str, float]
    total_depth_increase_cm: float

class HealthResponse(BaseModel):
    """Response from /health."""
    status: str = "ok"
    project: str = "Agastya"
    version: str = "1.0.0"
    location: str = "Minto Bridge, Delhi"
