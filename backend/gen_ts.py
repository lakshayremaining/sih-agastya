
import json
from pathlib import Path

cache_p = Path("data/cache/network.json")
with open(cache_p, "r", encoding="utf-8") as f:
    net = json.load(f)

nodes = net["nodes"]
edges = net["edges"]
potholes = net["potholes"]

edge_objs = [{
    "from_id": e["from"],
    "to_id": e["to"],
    "from_lat": e["from_lat"],
    "from_lon": e["from_lon"],
    "to_lat": e["to_lat"],
    "to_lon": e["to_lon"],
    "length": e["length"],
    "diameter": e["diameter"]
} for e in edges]

raw_edges = [[e["from"], e["to"], e["length"]] for e in edges]

with open("../frontend/src/lib/networkData.ts", "w", encoding="utf-8") as f:
    f.write("import type { NodeDepth, NetworkEdge, SimulateResponse, RouteResponse, PathCoord, PotholeHazard } from \"./api\";\n\n")
    f.write("export interface CatchmentNodeInfo {\n  lat: number;\n  lon: number;\n  elevation: number;\n  catch_area: number;\n  name: string;\n  role?: \"sag\" | \"hospital\" | \"railway\" | \"junction\";\n}\n\n")
    f.write("export const CATCHMENT_NODES: Record<string, CatchmentNodeInfo> = " + json.dumps(nodes, indent=2) + ";\n\n")
    f.write("export const POTHOLE_HAZARDS: PotholeHazard[] = " + json.dumps(potholes, indent=2) + ";\n\n")
    f.write("export const INITIAL_EDGES: NetworkEdge[] = " + json.dumps(edge_objs, indent=2) + ";\n\n")
    f.write("export const CATCHMENT_EDGES_RAW: Array<[string, string, number]> = " + json.dumps(raw_edges) + ";\n\n")
    f.write("export const INITIAL_NODES: NodeDepth[] = Object.entries(CATCHMENT_NODES).map(([id, info]) => ({\n  node_id: id,\n  id,\n  name: info.name,\n  lat: info.lat,\n  lon: info.lon,\n  lng: info.lon,\n  depth_cm: 0,\n  depth: 0,\n  risk_level: \"SAFE\",\n  risk: \"SAFE\",\n  blocked: false,\n  role: info.role || \"junction\",\n}));\n\n")

print("Created data section of networkData.ts")

