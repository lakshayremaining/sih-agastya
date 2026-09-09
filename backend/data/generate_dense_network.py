"""
Generate dense, realistic 20-30 km Greater Delhi road & drainage network.
Features:
- High-fidelity curvature nodes on all curvy roads, S-bends, underpasses, roundabouts, and crescents in the central 10km radius from Minto.
- Clean straight corridors without redundant collinear node spam.
- Complete connectivity for safe ambulance navigation and shortest path routing.
"""

import json
import math
from pathlib import Path

# Helper to compute distance between two lat/lon in meters
def haversine(lat1, lon1, lat2, lon2):
    R = 6371000 # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 1)

def build_dense_network():
    nodes = {}
    edges_list = []
    edges_set = set()

    def add_node(node_id, name, lat, lon, elevation, catch_area=3000, role="junction"):
        nodes[node_id] = {
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "elevation": round(elevation, 1),
            "catch_area": catch_area,
            "name": name,
            "role": role
        }

    pending_edges = []

    def add_edge(u, v, diameter=0.8, slope=0.003):
        pending_edges.append((u, v, diameter, slope))

    def resolve_edges():
        for u, v, diameter, slope in pending_edges:
            if u not in nodes or v not in nodes:
                print(f"Skipping edge {u} - {v} (node not found)")
                continue
            key = tuple(sorted([u, v]))
            if key in edges_set:
                continue
            edges_set.add(key)
            
            n1 = nodes[u]
            n2 = nodes[v]
            dist = haversine(n1["lat"], n1["lon"], n2["lat"], n2["lon"])
            
            # Calculate slope from elevations if available
            elev_diff = abs(n1["elevation"] - n2["elevation"])
            calc_slope = max(0.002, round(elev_diff / max(dist, 10), 4))
            
            edges_list.append({
                "from": u,
                "to": v,
                "from_id": u,
                "to_id": v,
                "from_lat": n1["lat"],
                "from_lon": n1["lon"],
                "to_lat": n2["lat"],
                "to_lon": n2["lon"],
                "length_m": dist,
                "length": dist,
                "diameter_m": diameter,
                "diameter": diameter,
                "slope": calc_slope
            })

    def add_corridor(node_ids_with_meta, diameter=0.9, max_segment_len=1800.0):
        """Add a sequence of connected nodes representing a street corridor without artificial collinear spam."""
        expanded_chain = []

        for i, item in enumerate(node_ids_with_meta):
            nid, name, lat, lon, elev, catch, role = item
            if nid not in nodes:
                add_node(nid, name, lat, lon, elev, catch, role)
            
            if i == 0:
                expanded_chain.append(nid)
            else:
                prev_id = expanded_chain[-1]
                p_node = nodes[prev_id]
                dist = haversine(p_node["lat"], p_node["lon"], lat, lon)
                
                # Only interpolate if distance exceeds very long max_segment_len (e.g. >1800m highway)
                if dist > max_segment_len:
                    num_sub = int(math.ceil(dist / max_segment_len))
                    last_id = prev_id
                    for step in range(1, num_sub):
                        fraction = step / float(num_sub)
                        wp_lat = p_node["lat"] + fraction * (lat - p_node["lat"])
                        wp_lon = p_node["lon"] + fraction * (lon - p_node["lon"])
                        wp_elev = p_node["elevation"] + fraction * (elev - p_node["elevation"])
                        wp_id = f"{nid}_wp{step}"
                        wp_name = f"{name} (Waypt {step})"
                        if wp_id not in nodes:
                            add_node(wp_id, wp_name, wp_lat, wp_lon, wp_elev, catch, "junction")
                        add_edge(last_id, wp_id, diameter=diameter)
                        last_id = wp_id
                    add_edge(last_id, nid, diameter=diameter)
                    expanded_chain.append(nid)
                else:
                    add_edge(prev_id, nid, diameter=diameter)
                    expanded_chain.append(nid)

    # ═════════════════════════════════════════════════════════════════
    # 1. CENTRAL DELHI & MINTO CATCHMENT CORE (Exact S-Bend Geometry)
    # ═════════════════════════════════════════════════════════════════
    # Minto S-Bend Corridor: North entry -> slope down -> sag sump -> slope up -> south exit -> Tagore curve
    add_corridor([
        ("minto_north", "Minto Road North", 28.6295, 77.2195, 214.2, 2500, "junction"),
        ("minto_slope_down", "Minto Underpass Descent Curve", 28.6287, 77.2196, 212.0, 2800, "junction"),
        ("minto_bridge_center", "Minto Bridge Underpass (Sag)", 28.6280, 77.2197, 210.5, 3500, "sag"),
        ("minto_slope_up", "Minto Underpass Ascent Curve", 28.6273, 77.2198, 212.2, 2600, "junction"),
        ("minto_south", "Minto Road South", 28.6265, 77.2199, 213.8, 2200, "junction"),
        ("tagore_road_curve", "Tagore Road Ingress Curve", 28.6255, 77.2203, 214.2, 2000, "junction"),
        ("tagore_road", "Tagore Road Junction", 28.6248, 77.2205, 214.5, 2000, "junction"),
        ("ddu_marg_east", "DDU Marg East (Rouse Ave)", 28.6282, 77.2220, 213.5, 2600, "junction"),
    ])

    add_corridor([
        ("cp_outer_s", "CP Outer Circle South", 28.6275, 77.2190, 215.5, 3200, "junction"),
        ("ddu_marg_west", "DDU Marg West", 28.6278, 77.2175, 214.0, 2800, "junction"),
        ("minto_bridge_center", "Minto Bridge Underpass (Sag)", 28.6280, 77.2197, 210.5, 3500, "sag"),
        ("ddu_marg_east", "DDU Marg East (Rouse Ave)", 28.6282, 77.2220, 213.5, 2600, "junction"),
        ("ito_junction", "ITO Junction (BSZ Marg)", 28.6285, 77.2410, 214.2, 3800, "junction"),
    ])
    add_edge("ddu_marg_west", "tagore_road")

    # ═════════════════════════════════════════════════════════════════
    # 2. CONNAUGHT PLACE HIGH-FIDELITY CIRCULAR RINGS (Inner & Outer 8-Point Arcs)
    # ═════════════════════════════════════════════════════════════════
    # CP Inner Circle (8-Point Circular Arc, ~250m radius)
    cp_inner_pts = [
        ("cp_inner_n", "CP Inner Circle North (Radial 1)", 28.6338, 77.2190, 216.0, 3000, "junction"),
        ("cp_inner_ne", "CP Inner Circle NE (Barakhamba)", 28.6331, 77.2212, 215.8, 3000, "junction"),
        ("cp_inner_e", "CP Inner Circle East (KG Marg)", 28.6315, 77.2222, 215.7, 3000, "junction"),
        ("cp_inner_se", "CP Inner Circle SE (Janpath)", 28.6299, 77.2212, 215.8, 3000, "junction"),
        ("cp_inner_s", "CP Inner Circle South (Sansad Marg)", 28.6292, 77.2190, 216.0, 3000, "junction"),
        ("cp_inner_sw", "CP Inner Circle SW (BKS Marg)", 28.6299, 77.2168, 216.0, 3000, "junction"),
        ("cp_inner_w", "CP Inner Circle West (Panchkuian)", 28.6315, 77.2158, 216.2, 3000, "junction"),
        ("cp_inner_nw", "CP Inner Circle NW (Chelmsford)", 28.6331, 77.2168, 216.2, 3000, "junction"),
    ]
    for pt in cp_inner_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    # Connect Inner Ring Arc
    for i in range(len(cp_inner_pts)):
        u = cp_inner_pts[i][0]
        v = cp_inner_pts[(i + 1) % len(cp_inner_pts)][0]
        add_edge(u, v, diameter=1.0)
    
    # CP Central Park Landmark Node connected to all inner sectors
    add_node("cp_inner", "Connaught Place Central Park", 28.6315, 77.2190, 216.0, 4000, "junction")
    for pt in cp_inner_pts:
        add_edge("cp_inner", pt[0], diameter=0.8)

    # CP Outer Circle (8-Point Circular Arc, ~450m radius)
    cp_outer_pts = [
        ("cp_outer_n", "CP Outer Circle North", 28.6355, 77.2190, 216.5, 3500, "junction"),
        ("cp_outer_ne", "CP Outer Circle NE (Barakhamba Ext)", 28.6343, 77.2230, 216.0, 3200, "junction"),
        ("cp_outer_e", "CP Outer Circle East (KG Marg Ext)", 28.6315, 77.2248, 215.8, 3200, "junction"),
        ("cp_outer_se", "CP Outer Circle SE (Tolstoy Ext)", 28.6287, 77.2230, 215.6, 3200, "junction"),
        ("cp_outer_s", "CP Outer Circle South", 28.6275, 77.2190, 215.5, 3200, "junction"),
        ("cp_outer_sw", "CP Outer Circle SW (BKS Marg Ext)", 28.6287, 77.2150, 216.2, 3200, "junction"),
        ("cp_outer_w", "CP Outer Circle West (Panchkuian Ext)", 28.6315, 77.2132, 216.5, 3200, "junction"),
        ("cp_outer_nw", "CP Outer Circle NW (Chelmsford Ext)", 28.6343, 77.2150, 216.5, 3200, "junction"),
    ]
    for pt in cp_outer_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    # Connect Outer Ring Arc
    for i in range(len(cp_outer_pts)):
        u = cp_outer_pts[i][0]
        v = cp_outer_pts[(i + 1) % len(cp_outer_pts)][0]
        add_edge(u, v, diameter=1.1)

    # Connect CP Radials (Inner to Outer)
    radial_pairs = [
        ("cp_inner_n", "cp_outer_n"),
        ("cp_inner_ne", "cp_outer_ne"),
        ("cp_inner_e", "cp_outer_e"),
        ("cp_inner_se", "cp_outer_se"),
        ("cp_inner_s", "cp_outer_s"),
        ("cp_inner_sw", "cp_outer_sw"),
        ("cp_inner_w", "cp_outer_w"),
        ("cp_inner_nw", "cp_outer_nw"),
    ]
    for u, v in radial_pairs:
        add_edge(u, v, diameter=1.0)

    # ═════════════════════════════════════════════════════════════════
    # 3. CP RADIAL ARTERIALS (Barakhamba, Janpath, KG Marg, Sansad Marg, Chelmsford)
    # ═════════════════════════════════════════════════════════════════
    # Janpath & Sansad Marg
    add_corridor([
        ("cp_radial_1", "CP Janpath North", 28.6328, 77.2185, 216.2, 3000, "junction"),
        ("cp_inner_s", "CP Inner Circle South (Sansad Marg)", 28.6292, 77.2190, 216.0, 3000, "junction"),
        ("cp_outer_s", "CP Outer Circle South", 28.6275, 77.2190, 215.5, 3200, "junction"),
        ("patel_chowk", "Patel Chowk Metro / Sansad Marg", 28.6230, 77.2140, 217.0, 3000, "junction"),
    ])
    add_edge("cp_radial_1", "cp_inner_n")

    # Barakhamba Road to Mandi House & Tilak Bridge S-Curve
    add_corridor([
        ("cp_outer_ne", "CP Outer Circle NE (Barakhamba Ext)", 28.6343, 77.2230, 216.0, 3200, "junction"),
        ("barakhamba_junction", "Barakhamba Road Junction", 28.6310, 77.2210, 215.0, 3000, "junction"),
        ("barakhamba_mid", "Barakhamba Road Mid", 28.6305, 77.2240, 214.5, 2200, "junction"),
        ("mandi_house", "Mandi House Circle Hub", 28.6255, 77.2340, 214.8, 3100, "junction"),
    ])

    # Chelmsford Road & NDLS Railway Corridor
    add_corridor([
        ("cp_outer_n", "CP Outer Circle North", 28.6355, 77.2190, 216.5, 3500, "junction"),
        ("chelmsford_road", "Chelmsford Road Junction", 28.6385, 77.2175, 215.2, 2900, "junction"),
        ("ndls_paharganj", "NDLS Paharganj Entry", 28.6415, 77.2170, 215.0, 3200, "junction"),
        ("ndls_railway_station", "New Delhi Railway Station (Ajmeri Gate)", 28.6425, 77.2215, 214.8, 4500, "railway"),
        ("minto_north", "Minto Road North", 28.6295, 77.2195, 214.2, 2500, "junction"),
    ])

    # Tolstoy Marg & KG Marg
    add_corridor([
        ("cp_outer_se", "CP Outer Circle SE (Tolstoy Ext)", 28.6287, 77.2230, 215.6, 3200, "junction"),
        ("janpath_tolstoy_crossing", "Janpath / Tolstoy Marg Crossing", 28.6275, 77.2185, 215.8, 2800, "junction"),
        ("kg_marg_junction", "KG Marg / Tolstoy Marg", 28.6270, 77.2245, 215.2, 2800, "junction"),
        ("barakhamba_mid", "Barakhamba Road Mid", 28.6305, 77.2240, 214.5, 2200, "junction"),
        ("mandi_house", "Mandi House Circle Hub", 28.6255, 77.2340, 214.8, 3100, "junction"),
    ])

    # ═════════════════════════════════════════════════════════════════
    # 4. ROUNDABOUTS IN 10 KM RADIUS (Curvature Geometry)
    # ═════════════════════════════════════════════════════════════════
    # Mandi House Circle Arc
    mandi_pts = [
        ("mandi_house_n", "Mandi House North (Barakhamba Ingress)", 28.6263, 77.2340, 214.8, 2800, "junction"),
        ("mandi_house_e", "Mandi House East (Sikandra Road)", 28.6255, 77.2348, 214.7, 2800, "junction"),
        ("mandi_house_s", "Mandi House South (Bhagwan Das Rd)", 28.6247, 77.2340, 214.8, 2800, "junction"),
        ("mandi_house_w", "Mandi House West (Copernicus Marg)", 28.6255, 77.2332, 214.9, 2800, "junction"),
    ]
    for pt in mandi_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(mandi_pts)):
        add_edge(mandi_pts[i][0], mandi_pts[(i + 1) % len(mandi_pts)][0], diameter=0.9)
    add_node("mandi_house", "Mandi House Circle Hub", 28.6255, 77.2340, 214.8, 3100, "junction")
    for pt in mandi_pts:
        add_edge("mandi_house", pt[0], diameter=0.8)

    # Windsor Place Roundabout Arc
    windsor_pts = [
        ("windsor_n", "Windsor Place North (Janpath Ingress)", 28.6198, 77.2185, 216.8, 2800, "junction"),
        ("windsor_e", "Windsor Place East (Ashoka Rd Ingress)", 28.6190, 77.2193, 216.8, 2800, "junction"),
        ("windsor_s", "Windsor Place South (Janpath Ingress)", 28.6182, 77.2185, 216.8, 2800, "junction"),
        ("windsor_w", "Windsor Place West (Ashoka Rd Ingress)", 28.6190, 77.2177, 216.8, 2800, "junction"),
    ]
    for pt in windsor_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(windsor_pts)):
        add_edge(windsor_pts[i][0], windsor_pts[(i + 1) % len(windsor_pts)][0], diameter=0.9)
    add_node("windsor_place_circle", "Windsor Place Roundabout", 28.6190, 77.2185, 216.8, 3200, "junction")
    for pt in windsor_pts:
        add_edge("windsor_place_circle", pt[0], diameter=0.8)

    # Gol Dak Khana Roundabout Arc
    goldak_pts = [
        ("goldak_n", "Gol Dak Khana North (BKS Ingress)", 28.6248, 77.2065, 217.5, 2800, "junction"),
        ("goldak_e", "Gol Dak Khana East (Ashoka Ingress)", 28.6240, 77.2073, 217.5, 2800, "junction"),
        ("goldak_s", "Gol Dak Khana South (Pt Pant Marg)", 28.6232, 77.2065, 217.5, 2800, "junction"),
        ("goldak_w", "Gol Dak Khana West (RML Ingress)", 28.6240, 77.2057, 217.5, 2800, "junction"),
    ]
    for pt in goldak_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(goldak_pts)):
        add_edge(goldak_pts[i][0], goldak_pts[(i + 1) % len(goldak_pts)][0], diameter=0.9)
    add_node("gol_dak_khana", "Gol Dak Khana Roundabout", 28.6240, 77.2065, 217.5, 3000, "junction")
    for pt in goldak_pts:
        add_edge("gol_dak_khana", pt[0], diameter=0.8)

    # Motilal Nehru Place / Claridges Roundabout
    motilal_pts = [
        ("motilal_nehru_n", "Motilal Nehru Place North", 28.6058, 77.2150, 218.0, 2800, "junction"),
        ("motilal_nehru_e", "Motilal Nehru Place East", 28.6050, 77.2158, 218.0, 2800, "junction"),
        ("motilal_nehru_s", "Motilal Nehru Place South", 28.6042, 77.2150, 218.0, 2800, "junction"),
        ("motilal_nehru_w", "Motilal Nehru Place West", 28.6050, 77.2142, 218.0, 2800, "junction"),
    ]
    for pt in motilal_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(motilal_pts)):
        add_edge(motilal_pts[i][0], motilal_pts[(i + 1) % len(motilal_pts)][0], diameter=0.9)
    add_node("motilal_nehru_place", "Motilal Nehru Place / Claridges", 28.6050, 77.2150, 218.0, 3000, "junction")
    for pt in motilal_pts:
        add_edge("motilal_nehru_place", pt[0], diameter=0.8)

    # Teen Murti Roundabout
    teen_murti_pts = [
        ("teen_murti_n", "Teen Murti North (Mother Teresa Ingress)", 28.6028, 77.1980, 220.0, 2800, "junction"),
        ("teen_murti_e", "Teen Murti East (Akbar Rd Ingress)", 28.6020, 77.1988, 220.0, 2800, "junction"),
        ("teen_murti_s", "Teen Murti South (Shanti Path Ingress)", 28.6012, 77.1980, 220.0, 2800, "junction"),
        ("teen_murti_w", "Teen Murti West (Kushak Rd Ingress)", 28.6020, 77.1972, 220.0, 2800, "junction"),
    ]
    for pt in teen_murti_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(teen_murti_pts)):
        add_edge(teen_murti_pts[i][0], teen_murti_pts[(i + 1) % len(teen_murti_pts)][0], diameter=0.9)
    add_node("teen_murti_marg", "Teen Murti Roundabout Hub", 28.6020, 77.1980, 220.0, 3200, "junction")
    for pt in teen_murti_pts:
        add_edge("teen_murti_marg", pt[0], diameter=0.8)

    # Tughlak Road Roundabout
    tughlak_pts = [
        ("tughlak_n", "Tughlak Road North", 28.5958, 77.2140, 218.5, 2800, "junction"),
        ("tughlak_e", "Tughlak Road East (APJ Abdul Kalam)", 28.5950, 77.2148, 218.5, 2800, "junction"),
        ("tughlak_s", "Tughlak Road South (Safdarjung)", 28.5942, 77.2140, 218.5, 2800, "junction"),
        ("tughlak_w", "Tughlak Road West (Prithviraj Rd)", 28.5950, 77.2132, 218.5, 2800, "junction"),
    ]
    for pt in tughlak_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(tughlak_pts)):
        add_edge(tughlak_pts[i][0], tughlak_pts[(i + 1) % len(tughlak_pts)][0], diameter=0.9)
    add_node("tughlak_road_roundabout", "Tughlak Road Roundabout", 28.5950, 77.2140, 218.5, 3100, "junction")
    for pt in tughlak_pts:
        add_edge("tughlak_road_roundabout", pt[0], diameter=0.8)

    # ═════════════════════════════════════════════════════════════════
    # 5. INDIA GATE C-HEXAGON COMPLETE OCTAGONAL/HEXAGONAL RING ARC
    # ═════════════════════════════════════════════════════════════════
    c_hexagon_pts = [
        ("c_hexagon_n", "India Gate C-Hexagon North (Tilak/KG Marg)", 28.6160, 77.2295, 216.5, 3600, "junction"),
        ("c_hexagon_ne", "India Gate C-Hexagon NE (Purana Qila Rd)", 28.6150, 77.2325, 216.4, 3400, "junction"),
        ("c_hexagon_e", "India Gate C-Hexagon East (Sher Shah Suri)", 28.6129, 77.2338, 216.5, 3400, "junction"),
        ("c_hexagon_se", "India Gate C-Hexagon SE (Pandara Rd)", 28.6105, 77.2325, 216.6, 3400, "junction"),
        ("c_hexagon_s", "India Gate C-Hexagon South (Shahjahan Rd)", 28.6095, 77.2295, 216.8, 3500, "junction"),
        ("c_hexagon_sw", "India Gate C-Hexagon SW (Akbar Rd)", 28.6105, 77.2265, 216.8, 3400, "junction"),
        ("c_hexagon_w", "India Gate C-Hexagon West (Kartavya Path)", 28.6129, 77.2252, 217.0, 3600, "junction"),
        ("c_hexagon_nw", "India Gate C-Hexagon NW (Ashoka Rd)", 28.6150, 77.2265, 216.7, 3400, "junction"),
    ]
    for pt in c_hexagon_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(c_hexagon_pts)):
        add_edge(c_hexagon_pts[i][0], c_hexagon_pts[(i + 1) % len(c_hexagon_pts)][0], diameter=1.1)

    # Aliases for backward compatibility
    add_node("c_hexagon_north", "India Gate C-Hexagon North", 28.6150, 77.2295, 216.5, 3600, "junction")
    add_node("c_hexagon_south", "India Gate C-Hexagon South", 28.6105, 77.2295, 216.8, 3500, "junction")
    add_node("india_gate", "India Gate Monument Central Hub", 28.6129, 77.2295, 217.0, 4200, "junction")
    add_edge("c_hexagon_north", "c_hexagon_n")
    add_edge("c_hexagon_south", "c_hexagon_s")
    for pt in c_hexagon_pts:
        add_edge("india_gate", pt[0], diameter=0.9)

    # Connect Windsor & Ashoka Road to C-Hexagon
    add_edge("patel_chowk", "windsor_w")
    add_edge("windsor_e", "c_hexagon_nw")
    add_edge("janpath_tolstoy_crossing", "windsor_n")

    # Kartavya Path (Rajpath) Boulevard
    add_corridor([
        ("vijay_chowk", "Vijay Chowk / Rashtrapati Bhavan", 28.6140, 77.2070, 218.5, 4000, "junction"),
        ("central_secretariat", "Central Secretariat (Krishi Bhawan)", 28.6180, 77.2140, 217.5, 3500, "junction"),
        ("kartavya_path_janpath", "Kartavya Path / Janpath Crossing", 28.6135, 77.2185, 217.0, 3600, "junction"),
        ("kartavya_path_mansingh", "Kartavya Path / Man Singh Road", 28.6132, 77.2240, 216.8, 3500, "junction"),
        ("c_hexagon_w", "India Gate C-Hexagon West (Kartavya Path)", 28.6129, 77.2252, 217.0, 3600, "junction"),
    ])
    add_edge("windsor_s", "kartavya_path_janpath")

    # Khan Market & Lodhi Estate Grid
    add_corridor([
        ("c_hexagon_s", "India Gate C-Hexagon South (Shahjahan Rd)", 28.6095, 77.2295, 216.8, 3500, "junction"),
        ("shahjahan_road_mid", "Shahjahan Road / UPSC", 28.6040, 77.2280, 216.5, 3200, "junction"),
        ("khan_market_metro", "Khan Market Metro / Lok Nayak Bhawan", 28.5990, 77.2270, 216.8, 3800, "junction"),
        ("lodhi_gardens_gate", "Lodhi Gardens South Gate", 28.5910, 77.2210, 217.5, 3400, "junction"),
        ("lodhi_road_ina", "Lodhi Road / INA Market", 28.5830, 77.2130, 218.0, 3500, "junction"),
    ])
    add_edge("motilal_nehru_e", "shahjahan_road_mid")
    add_edge("khan_market_metro", "sunder_nagar_zoo")

    # ═════════════════════════════════════════════════════════════════
    # 6. S-CURVES, UNDERPASSES & BEND ARCS IN 10 KM RADIUS
    # ═════════════════════════════════════════════════════════════════
    # 6A. Tilak Bridge Railway Underpass S-Curve (Mandi House -> Tilak Bridge Sag -> ITO)
    add_corridor([
        ("mandi_house_e", "Mandi House East (Sikandra Road)", 28.6255, 77.2348, 214.7, 2800, "junction"),
        ("tilak_bridge_w_curve", "Tilak Bridge Western Descent Arc", 28.6248, 77.2360, 213.0, 3000, "junction"),
        ("tilak_bridge", "Tilak Bridge Underpass Sag", 28.6240, 77.2380, 211.2, 3400, "sag"),
        ("tilak_bridge_e_curve", "Tilak Bridge Eastern Ascent Arc", 28.6258, 77.2395, 212.8, 3000, "junction"),
        ("appu_ghar_bend", "Appu Ghar Road Curve", 28.6272, 77.2405, 213.8, 3200, "junction"),
        ("ito_junction", "ITO Junction (BSZ Marg)", 28.6285, 77.2410, 214.2, 3800, "junction"),
    ])

    # 6B. Pragati Maidan Subterranean Integrated Transit Tunnel S-Curve
    add_corridor([
        ("mandi_house_s", "Mandi House South (Bhagwan Das Rd)", 28.6247, 77.2340, 214.8, 2800, "junction"),
        ("pragati_tunnel_entry_w", "Pragati Tunnel West Approach Ramp", 28.6235, 77.2370, 213.5, 3200, "junction"),
        ("pragati_tunnel_mid_curve1", "Pragati Tunnel Underground Curve 1", 28.6225, 77.2415, 211.0, 3500, "junction"),
        ("pragati_maidan_tunnel", "Pragati Maidan Tunnel Subterranean Sag", 28.6210, 77.2460, 209.5, 3800, "sag"),
        ("pragati_tunnel_mid_curve2", "Pragati Tunnel Underground Curve 2", 28.6200, 77.2505, 211.2, 3500, "junction"),
        ("pragati_maidan_east", "Pragati Maidan Ring Road Bypass", 28.6180, 77.2540, 213.0, 3200, "junction"),
    ])

    # 6C. Chanakyapuri Diplomatic Enclave Crescents (Mother Teresa, Shanti Path, Niti Marg)
    # Mother Teresa / Willingdon Crescent
    add_corridor([
        ("talkatora_garden", "Talkatora Garden Junction", 28.6190, 77.1950, 219.0, 3200, "junction"),
        ("willingdon_crescent_bend1", "Willingdon Crescent North Curve", 28.6150, 77.1930, 220.0, 3000, "junction"),
        ("willingdon_crescent", "Mother Teresa Crescent Hub", 28.6110, 77.1910, 221.0, 3000, "junction"),
        ("willingdon_crescent_bend2", "Willingdon Crescent South Curve", 28.6060, 77.1895, 220.5, 3000, "junction"),
        ("teen_murti_n", "Teen Murti North (Mother Teresa Ingress)", 28.6028, 77.1980, 220.0, 2800, "junction"),
    ])

    # Shanti Path Crescent
    add_corridor([
        ("teen_murti_s", "Teen Murti South (Shanti Path Ingress)", 28.6012, 77.1980, 220.0, 2800, "junction"),
        ("shanti_path_n_bend", "Shanti Path Diplomatic North Curve", 28.5980, 77.1940, 221.5, 3100, "junction"),
        ("shanti_path_mid_crescent", "Shanti Path Central Crescent Apex", 28.5910, 77.1890, 222.0, 3500, "junction"),
        ("shanti_path_s_bend", "Shanti Path Diplomatic South Curve", 28.5830, 77.1860, 221.5, 3100, "junction"),
        ("motibagh_ring_road", "Moti Bagh Ring Road Junction", 28.5830, 77.1700, 222.0, 3600, "junction"),
    ])

    # Niti Marg Crescent
    add_corridor([
        ("teen_murti_e", "Teen Murti East (Akbar Rd Ingress)", 28.6020, 77.1988, 220.0, 2800, "junction"),
        ("niti_marg_n_bend", "Niti Marg North Curve", 28.5960, 77.1995, 220.0, 3000, "junction"),
        ("niti_marg_mid_crescent", "Niti Marg Central Crescent Apex", 28.5890, 77.1970, 219.5, 3200, "junction"),
        ("niti_marg_s_bend", "Niti Marg South Curve", 28.5820, 77.1950, 219.0, 3000, "junction"),
        ("lodhi_road_ina", "Lodhi Road / INA Market", 28.5830, 77.2130, 218.0, 3500, "junction"),
    ])

    # 6D. Zakhira Rohtak Road Underpass Bend
    add_corridor([
        ("shadipur_depot", "Shadipur Depot Junction", 28.6520, 77.1530, 216.5, 3300, "junction"),
        ("zakhira_approach_w", "Zakhira Rohtak Rd West Approach", 28.6580, 77.1535, 215.0, 3400, "junction"),
        ("zakhira_bend_1", "Zakhira Underpass Descent Bend", 28.6620, 77.1540, 213.2, 3800, "junction"),
        ("zakhira_underpass", "Zakhira Underpass (Rohtak Road Sag)", 28.6652, 77.1548, 211.5, 4100, "sag"),
        ("zakhira_bend_2", "Zakhira Underpass Ascent Bend", 28.6680, 77.1565, 213.5, 3600, "junction"),
        ("wazirpur_industrial", "Wazirpur Industrial Area Ring Road", 28.6880, 77.1600, 216.0, 3400, "junction"),
    ])

    # 6E. Moolchand Underpass Loop & Curved Slipway
    add_corridor([
        ("south_extension", "South Extension Ring Road", 28.5710, 77.2220, 216.0, 3600, "junction"),
        ("moolchand_ringroad_w", "Moolchand Flyover West Approach", 28.5680, 77.2280, 215.5, 3400, "junction"),
        ("moolchand_curve_n", "Moolchand Underpass Ingress Curve", 28.5668, 77.2320, 213.0, 3600, "junction"),
        ("moolchand_underpass", "Moolchand Underpass Sag", 28.5660, 77.2350, 210.8, 3800, "sag"),
        ("moolchand_hospital", "Moolchand Medcity Hospital", 28.5650, 77.2340, 216.5, 4000, "hospital"),
        ("moolchand_curve_s", "Moolchand Underpass Egress Curve", 28.5670, 77.2380, 213.2, 3500, "junction"),
        ("lajpat_nagar", "Lajpat Nagar Central Market Ring Rd", 28.5690, 77.2430, 215.0, 3900, "junction"),
    ])

    # 6F. Ashram Flyover & Underpass S-Curve / Cloverleaf
    add_corridor([
        ("lajpat_nagar", "Lajpat Nagar Central Market Ring Rd", 28.5690, 77.2430, 215.0, 3900, "junction"),
        ("ashram_approach_w", "Ashram Ring Road West Descent", 28.5700, 77.2510, 214.0, 3600, "junction"),
        ("ashram_cloverleaf_w", "Ashram Underpass Entry S-Curve", 28.5710, 77.2550, 212.0, 3900, "junction"),
        ("ashram_chowk_sag", "Ashram Chowk Underpass Sag", 28.5710, 77.2580, 210.2, 4200, "sag"),
        ("ashram_flyover", "Ashram Chowk Flyover Junction", 28.5720, 77.2590, 215.5, 4000, "junction"),
        ("ashram_cloverleaf_e", "Ashram Mathura Road Exit Curve", 28.5715, 77.2630, 213.5, 3800, "junction"),
        ("new_friends_colony", "New Friends Colony Mathura Rd", 28.5630, 77.2690, 214.5, 3300, "junction"),
    ])

    # 6G. Yamuna Riverbank & Ring Road Curves
    add_corridor([
        ("kashmere_gate_sag", "Kashmere Gate Ring Road Sag", 28.6640, 77.2340, 211.8, 3600, "sag"),
        ("yamuna_bank_bend1", "Yamuna Bank Ring Road North Bend", 28.6610, 77.2385, 212.5, 3200, "junction"),
        ("yamuna_bazaar", "Yamuna Bazaar Ring Road", 28.6580, 77.2430, 213.0, 3100, "junction"),
        ("geeta_colony_loop", "Geeta Colony Bridge Approach Loop", 28.6520, 77.2460, 213.2, 3300, "junction"),
        ("shantivan_crossing", "Shantivan Ring Road Crossing", 28.6460, 77.2480, 213.5, 3300, "junction"),
        ("rajghat_crossing", "Rajghat Ring Road Crossing", 28.6380, 77.2510, 213.8, 3400, "junction"),
        ("ito_yamuna_bridge", "ITO Yamuna Barrage Bridge", 28.6295, 77.2520, 213.5, 3000, "junction"),
        ("pragati_maidan_east", "Pragati Maidan Ring Road Bypass", 28.6180, 77.2540, 213.0, 3200, "junction"),
        ("sarai_kale_khan_isbt", "Sarai Kale Khan ISBT / RRTS", 28.5910, 77.2560, 212.5, 4600, "railway"),
        ("ashram_flyover", "Ashram Chowk Flyover Junction", 28.5720, 77.2590, 215.5, 4000, "junction"),
    ])

    # ═════════════════════════════════════════════════════════════════
    # 7. CENTRAL HOSPITALS CORRIDOR (RML, Lady Hardinge, LNJP, GB Pant)
    # ═════════════════════════════════════════════════════════════════
    add_corridor([
        ("cp_outer_sw", "CP Outer Circle SW (BKS Marg Ext)", 28.6287, 77.2150, 216.2, 3200, "junction"),
        ("bks_marg_mid", "Baba Kharak Singh Marg Mid", 28.6260, 77.2100, 216.8, 2800, "junction"),
        ("goldak_w", "Gol Dak Khana West (RML Ingress)", 28.6240, 77.2057, 217.5, 2800, "junction"),
        ("rml_hospital", "Dr. Ram Manohar Lohia (RML) Hospital", 28.6235, 77.1995, 218.2, 4500, "hospital"),
        ("talkatora_garden", "Talkatora Garden Junction", 28.6190, 77.1950, 219.0, 3200, "junction"),
    ])

    add_corridor([
        ("cp_outer_w", "CP Outer Circle West (Panchkuian Ext)", 28.6315, 77.2132, 216.5, 3200, "junction"),
        ("lady_hardinge", "Lady Hardinge Medical College & Hospital", 28.6325, 77.2135, 216.0, 3500, "hospital"),
        ("panchkuian_road_1", "Panchkuian Road Junction", 28.6350, 77.2080, 216.5, 3000, "junction"),
    ])

    add_corridor([
        ("ito_junction", "ITO Junction (BSZ Marg)", 28.6285, 77.2410, 214.2, 3800, "junction"),
        ("bsz_marg_mid", "BSZ Marg / Express Building", 28.6330, 77.2405, 214.0, 3000, "junction"),
        ("delhi_gate", "Delhi Gate (Asaf Ali Road)", 28.6390, 77.2400, 214.5, 3600, "junction"),
        ("lnjp_hospital", "LNJP Hospital (Lok Nayak)", 28.6370, 77.2425, 213.5, 4800, "hospital"),
        ("gb_pant_hospital", "GB Pant Hospital Complex", 28.6355, 77.2435, 213.8, 3800, "hospital"),
        ("asaf_ali_road", "Asaf Ali Road West", 28.6410, 77.2340, 215.0, 3100, "junction"),
        ("ndls_railway_station", "New Delhi Railway Station (Ajmeri Gate)", 28.6425, 77.2215, 214.8, 4500, "railway"),
    ])

    # Paharganj & Karol Bagh Inner Grid
    add_corridor([
        ("ndls_paharganj", "NDLS Paharganj Entry", 28.6415, 77.2170, 215.0, 3200, "junction"),
        ("paharganj_main_bazaar", "Paharganj Main Bazaar Crossing", 28.6420, 77.2100, 216.0, 3100, "junction"),
        ("dbg_road_crossing", "Desh Bandhu Gupta Road", 28.6460, 77.2050, 216.8, 3300, "junction"),
        ("jhandewalan_mandir", "Jhandewalan Link Road", 28.6410, 77.1980, 217.5, 3200, "junction"),
        ("ajmal_khan_road", "Ajmal Khan Road Market", 28.6470, 77.1920, 218.2, 3600, "junction"),
        ("karol_bagh", "Karol Bagh Pusa Road", 28.6445, 77.1890, 219.0, 3500, "junction"),
    ])
    add_edge("dbg_road_crossing", "ajmal_khan_road")

    # ═════════════════════════════════════════════════════════════════
    # 8. NORTH DELHI CORRIDOR (Old Delhi, Kashmere Gate, Civil Lines, DU, Azadpur)
    # ═════════════════════════════════════════════════════════════════
    add_corridor([
        ("delhi_gate", "Delhi Gate (Asaf Ali Road)", 28.6390, 77.2400, 214.5, 3600, "junction"),
        ("netaji_subhash_marg", "Netaji Subhash Marg (Daryaganj)", 28.6465, 77.2405, 214.2, 3500, "junction"),
        ("red_fort_junction", "Red Fort Chowk (Lal Qila)", 28.6540, 77.2390, 214.0, 4200, "junction"),
        ("chandni_chowk_east", "Chandni Chowk / Fountain", 28.6565, 77.2330, 214.5, 3800, "junction"),
        ("old_delhi_station", "Old Delhi Railway Station", 28.6610, 77.2280, 214.0, 4000, "railway"),
        ("kashmere_gate_mori", "Mori Gate / Pul Mithai", 28.6630, 77.2250, 213.5, 3400, "junction"),
        ("kashmere_gate_isbt", "Kashmere Gate ISBT", 28.6675, 77.2325, 213.0, 4800, "railway"),
        ("kashmere_gate_sag", "Kashmere Gate Ring Road Sag", 28.6640, 77.2340, 211.8, 3600, "sag"),
    ])

    add_corridor([
        ("kashmere_gate_isbt", "Kashmere Gate ISBT", 28.6675, 77.2325, 213.0, 4800, "railway"),
        ("civil_lines", "Civil Lines Sham Nath Marg", 28.6810, 77.2230, 215.5, 3100, "junction"),
        ("mall_road_junction", "Mall Road / Khyber Pass", 28.6880, 77.2200, 216.0, 3200, "junction"),
        ("du_north_campus", "Delhi University North Campus", 28.6920, 77.2120, 216.5, 3900, "junction"),
        ("gt_karnal_derawal", "GT Karnal Road / Derawal Nagar", 28.6990, 77.1950, 215.8, 3500, "junction"),
        ("azadpur_mandi", "Azadpur Chowk / GT Karnal Road", 28.7070, 77.1770, 215.0, 4200, "junction"),
        ("azadpur_sag", "Azadpur Underpass Sag", 28.7090, 77.1750, 212.0, 3800, "sag"),
        ("model_town_3", "Model Town III Junction", 28.7020, 77.1860, 215.5, 3100, "junction"),
    ])
    add_edge("model_town_3", "du_north_campus")
    add_edge("model_town_3", "azadpur_mandi")

    add_corridor([
        ("azadpur_mandi", "Azadpur Chowk / GT Karnal Road", 28.7070, 77.1770, 215.0, 4200, "junction"),
        ("shalimar_bagh_entry", "Shalimar Bagh Ring Road", 28.7085, 77.1620, 215.5, 3300, "junction"),
        ("max_hospital_shalimar_bagh", "Max Super Speciality Shalimar Bagh", 28.7120, 77.1550, 216.0, 4000, "hospital"),
        ("netaji_subhash_place", "Netaji Subhash Place (Pitampura)", 28.6950, 77.1520, 216.5, 3800, "junction"),
        ("wazirpur_industrial", "Wazirpur Industrial Area Ring Road", 28.6880, 77.1600, 216.0, 3400, "junction"),
    ])
    add_edge("wazirpur_industrial", "azadpur_mandi")

    # ═════════════════════════════════════════════════════════════════
    # 9. WEST DELHI CORRIDOR (Karol Bagh, Patel Nagar, Rajouri, Janakpuri, Dwarka)
    # ═════════════════════════════════════════════════════════════════
    add_corridor([
        ("panchkuian_road_1", "Panchkuian Road Junction", 28.6350, 77.2080, 216.5, 3000, "junction"),
        ("jhandewalan_mandir", "Jhandewalan Link Road", 28.6410, 77.1980, 217.5, 3200, "junction"),
        ("karol_bagh", "Karol Bagh Pusa Road", 28.6445, 77.1890, 219.0, 3500, "junction"),
        ("ganga_ram_hospital", "Sir Ganga Ram Hospital", 28.6385, 77.1895, 219.0, 3400, "hospital"),
        ("blkapoor_hospital", "BLK-Max Super Speciality Hospital", 28.6450, 77.1820, 218.5, 3600, "hospital"),
        ("rajendra_place", "Rajendra Place Metro Hub", 28.6435, 77.1780, 218.0, 3200, "junction"),
        ("patel_nagar_east", "East Patel Nagar Main Market", 28.6480, 77.1680, 217.5, 3100, "junction"),
        ("patel_nagar", "Patel Nagar Main Road", 28.6508, 77.1575, 217.0, 3400, "junction"),
        ("shadipur_depot", "Shadipur Depot Junction", 28.6520, 77.1530, 216.5, 3300, "junction"),
    ])
    add_edge("karol_bagh", "ganga_ram_hospital")
    add_edge("karol_bagh", "blkapoor_hospital")
    add_edge("blkapoor_hospital", "rajendra_place")

    add_corridor([
        ("shadipur_depot", "Shadipur Depot Junction", 28.6520, 77.1530, 216.5, 3300, "junction"),
        ("moti_nagar_chowk", "Moti Nagar Ring Road Crossing", 28.6540, 77.1420, 217.0, 3500, "junction"),
        ("ramesh_nagar", "Ramesh Nagar Metro Corridor", 28.6520, 77.1310, 217.5, 3000, "junction"),
        ("rajouri_garden", "Rajouri Garden Ring Road Chowk", 28.6490, 77.1220, 218.0, 3800, "junction"),
        ("tagore_garden_metro", "Tagore Garden Metro", 28.6440, 77.1110, 218.5, 3200, "junction"),
        ("subhash_nagar_crossing", "Subhash Nagar Crossing", 28.6380, 77.1020, 219.0, 3400, "junction"),
        ("tilak_nagar_chowk", "Tilak Nagar Chowk", 28.6350, 77.0910, 219.5, 3600, "junction"),
        ("janakpuri_dc", "Janakpuri District Centre", 28.6290, 77.0810, 220.0, 3700, "junction"),
        ("janakpuri_super_speciality", "Janakpuri Super Speciality Hospital", 28.6210, 77.0850, 220.5, 3500, "hospital"),
        ("uttam_nagar_east", "Uttam Nagar East / Najafgarh Rd", 28.6220, 77.0650, 221.0, 3600, "junction"),
        ("dwarka_mor", "Dwarka Mor Intersection", 28.6180, 77.0320, 222.0, 3900, "junction"),
        ("manipal_dwarka", "Manipal Hospital Dwarka Sector 6", 28.5880, 77.0580, 223.5, 3600, "hospital"),
    ])
    add_edge("janakpuri_dc", "janakpuri_super_speciality")

    add_corridor([
        ("janakpuri_dc", "Janakpuri District Centre", 28.6290, 77.0810, 220.0, 3700, "junction"),
        ("vikaspuri_flyover", "Vikaspuri Outer Ring Road", 28.6420, 77.0780, 220.5, 3300, "junction"),
        ("peera_garhi_chowk", "Peera Garhi Chowk (Rohtak Rd)", 28.6780, 77.0950, 218.5, 4100, "junction"),
        ("mangolpuri_flyover", "Mangolpuri Outer Ring Road", 28.6920, 77.1120, 217.5, 3500, "junction"),
        ("madhuban_chowk", "Madhuban Chowk (Pitampura)", 28.7010, 77.1320, 217.0, 3800, "junction"),
        ("netaji_subhash_place", "Netaji Subhash Place (Pitampura)", 28.6950, 77.1520, 216.5, 3800, "junction"),
    ])
    add_edge("zakhira_underpass", "peera_garhi_chowk")
    add_edge("wazirpur_industrial", "moti_nagar_chowk")

    # ═════════════════════════════════════════════════════════════════
    # 10. SOUTH-WEST CORRIDOR & DHAULA KUAN MULTI-TIER LOOPS
    # ═════════════════════════════════════════════════════════════════
    # Dhaula Kuan Multi-tier Interchange Quadrants
    dhaula_pts = [
        ("dhaula_kuan_n", "Dhaula Kuan North Flyover Loop", 28.5935, 77.1608, 225.0, 3400, "junction"),
        ("dhaula_kuan_e", "Dhaula Kuan East Ring Road Loop", 28.5922, 77.1625, 224.5, 3400, "junction"),
        ("dhaula_kuan_s", "Dhaula Kuan South NH-48 Ramp", 28.5908, 77.1595, 224.0, 3400, "junction"),
        ("dhaula_kuan_w", "Dhaula Kuan West Cantt Flyover Ramp", 28.5915, 77.1575, 224.5, 3400, "junction"),
    ]
    for pt in dhaula_pts:
        add_node(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], pt[6])
    for i in range(len(dhaula_pts)):
        add_edge(dhaula_pts[i][0], dhaula_pts[(i + 1) % len(dhaula_pts)][0], diameter=1.0)
    
    add_node("dhaula_kuan", "Dhaula Kuan Interchange Central Hub", 28.5920, 77.1600, 225.0, 4800, "junction")
    add_node("dhaula_kuan_sag", "Dhaula Kuan Underpass Sag", 28.5900, 77.1580, 218.0, 3400, "sag")
    for pt in dhaula_pts:
        add_edge("dhaula_kuan", pt[0], diameter=0.9)
    add_edge("dhaula_kuan", "dhaula_kuan_sag")

    add_corridor([
        ("willingdon_crescent", "Mother Teresa Crescent Hub", 28.6110, 77.1910, 221.0, 3000, "junction"),
        ("sardar_patel_marg_1", "Sardar Patel Marg / Diplomatic", 28.6010, 77.1780, 223.0, 3200, "junction"),
        ("sardar_patel_marg_2", "Sardar Patel Marg / Taj Palace", 28.5950, 77.1680, 224.5, 3100, "junction"),
        ("dhaula_kuan_n", "Dhaula Kuan North Flyover Loop", 28.5935, 77.1608, 225.0, 3400, "junction"),
    ])

    add_corridor([
        ("dhaula_kuan_w", "Dhaula Kuan West Cantt Flyover Ramp", 28.5915, 77.1575, 224.5, 3400, "junction"),
        ("delhi_cantt", "Delhi Cantt Flyover (Jail Road)", 28.5980, 77.1300, 223.0, 3500, "junction"),
        ("mayapuri_crossing", "Mayapuri Ring Road Crossing", 28.6310, 77.1260, 220.0, 3400, "junction"),
        ("rajouri_garden", "Rajouri Garden Ring Road Chowk", 28.6490, 77.1220, 218.0, 3800, "junction"),
    ])
    add_edge("delhi_cantt", "mayapuri_crossing")

    add_corridor([
        ("dhaula_kuan_s", "Dhaula Kuan South NH-48 Ramp", 28.5908, 77.1595, 224.0, 3400, "junction"),
        ("subroto_park", "Subroto Park Western Air Command", 28.5810, 77.1480, 226.0, 3200, "junction"),
        ("aps_colony_ramp", "APS Colony NH-48 Ramp", 28.5680, 77.1320, 227.0, 3300, "junction"),
        ("igi_airport_t1", "IGI Airport Terminal 1", 28.5620, 77.1180, 228.0, 4500, "railway"),
        ("aerocity_hospitality", "Aerocity Worldmark Hub", 28.5510, 77.1210, 229.0, 3600, "junction"),
        ("mahipalpur_flyover", "Mahipalpur NH-48 Junction", 28.5440, 77.1260, 230.0, 3800, "junction"),
        ("igi_airport_t3", "IGI Airport Terminal 3 (International)", 28.5560, 77.0850, 231.0, 5000, "railway"),
        ("dwarka_underpass", "Dwarka Sector 21 Airport Link", 28.5520, 77.0580, 226.0, 3500, "junction"),
        ("manipal_dwarka", "Manipal Hospital Dwarka Sector 6", 28.5880, 77.0580, 223.5, 3600, "hospital"),
    ])
    add_edge("igi_airport_t1", "aerocity_hospitality")
    add_edge("igi_airport_t3", "dwarka_underpass")

    # ═════════════════════════════════════════════════════════════════
    # 11. SOUTH DELHI INNER RING ROAD & AIIMS MEDICAL CORRIDOR
    # ═════════════════════════════════════════════════════════════════
    add_corridor([
        ("dhaula_kuan_e", "Dhaula Kuan East Ring Road Loop", 28.5922, 77.1625, 224.5, 3400, "junction"),
        ("motibagh_ring_road", "Moti Bagh Ring Road Junction", 28.5830, 77.1700, 222.0, 3600, "junction"),
        ("hyatt_bhikaji_cama", "Hyatt Regency / Bhikaji Cama", 28.5720, 77.1880, 220.0, 3500, "junction"),
        ("bhikaji_cama", "Bhikaji Cama Place Flyover", 28.5680, 77.1890, 219.0, 3800, "junction"),
        ("safdarjung_enclave_entry", "Safdarjung Enclave Ring Road", 28.5690, 77.1990, 218.0, 3200, "junction"),
        ("safdarjung_hospital", "Safdarjung Hospital Emergency", 28.5685, 77.2060, 217.0, 4800, "hospital"),
        ("aiims_delhi", "AIIMS New Delhi (Apex Trauma Centre)", 28.5672, 77.2100, 217.5, 5200, "hospital"),
        ("aiims_flyover_sag", "AIIMS Ring Road Subway Sag", 28.5665, 77.2110, 211.0, 3400, "sag"),
        ("south_extension", "South Extension Ring Road", 28.5710, 77.2220, 216.0, 3600, "junction"),
        ("moolchand_flyover_w", "Moolchand Flyover West", 28.5652, 77.2341, 216.5, 3200, "junction"),
        ("cp_outer_s", "CP Outer Circle South", 28.6275, 77.2190, 215.5, 3200, "junction"),
    ])
    add_edge("aiims_delhi", "safdarjung_hospital")
    add_edge("moolchand_flyover_w", "cp_outer_s")
    add_edge("moolchand_flyover_w", "lodhi_road_ina")
    add_edge("moolchand_flyover_w", "barakhamba_junction")
    add_edge("moolchand_flyover_w", "patel_chowk")

    # Aurobindo Marg Radial: Central Secretariat -> AIIMS -> IIT Delhi -> Saket
    add_corridor([
        ("patel_chowk", "Patel Chowk Metro / Sansad Marg", 28.6230, 77.2140, 217.0, 3000, "junction"),
        ("central_secretariat", "Central Secretariat (Krishi Bhawan)", 28.6180, 77.2140, 217.5, 3500, "junction"),
        ("motilal_nehru_s", "Motilal Nehru Place South", 28.6042, 77.2150, 218.0, 2800, "junction"),
        ("tughlak_n", "Tughlak Road North", 28.5958, 77.2140, 218.5, 2800, "junction"),
        ("safdarjung_tomb", "Safdarjung Airport / Tomb", 28.5890, 77.2100, 218.5, 3000, "junction"),
        ("lodhi_road_ina", "Lodhi Road / INA Market", 28.5830, 77.2130, 218.0, 3500, "junction"),
        ("aiims_delhi", "AIIMS New Delhi (Apex Trauma Centre)", 28.5672, 77.2100, 217.5, 5200, "hospital"),
        ("green_park_market", "Green Park Aurobindo Marg", 28.5580, 77.2060, 219.0, 3300, "junction"),
        ("hauz_khas", "Hauz Khas Metro Interchange", 28.5430, 77.2060, 221.0, 3800, "junction"),
        ("iit_delhi", "IIT Delhi Outer Ring Road", 28.5450, 77.1920, 222.5, 4100, "junction"),
        ("adchini_crossing", "Adchini Village / Aurobindo Marg", 28.5340, 77.1960, 223.0, 3200, "junction"),
        ("qutub_minar_metro", "Qutub Minar Metro / Mehrauli", 28.5190, 77.1850, 226.0, 3700, "junction"),
        ("max_hospital_saket", "Max Super Speciality Hospital Saket", 28.5270, 77.2140, 224.0, 4500, "hospital"),
        ("saket_city_hospital", "Smart Super Speciality Saket", 28.5285, 77.2160, 224.2, 3800, "hospital"),
        ("saket_district_centre", "Select Citywalk / Saket DC", 28.5280, 77.2190, 223.5, 3900, "junction"),
    ])
    add_edge("safdarjung_tomb", "lodhi_road_ina")
    add_edge("lodhi_road_ina", "aiims_delhi")
    add_edge("hauz_khas", "iit_delhi")
    add_edge("hauz_khas", "max_hospital_saket")
    add_edge("max_hospital_saket", "saket_city_hospital")
    add_edge("saket_city_hospital", "saket_district_centre")

    # ═════════════════════════════════════════════════════════════════
    # 12. SOUTH-EAST CORRIDOR (Nehru Place, Okhla, Fortis Escorts, Apollo, Pul Prahladpur)
    # ═════════════════════════════════════════════════════════════════
    add_corridor([
        ("iit_delhi", "IIT Delhi Outer Ring Road", 28.5450, 77.1920, 222.5, 4100, "junction"),
        ("panchsheel_flyover", "Panchsheel Flyover", 28.5460, 77.2180, 221.0, 3400, "junction"),
        ("chirag_delhi_flyover", "Chirag Delhi Flyover", 28.5455, 77.2340, 219.0, 3600, "junction"),
        ("greater_kailash_metro", "Greater Kailash Enclave", 28.5470, 77.2420, 218.0, 3300, "junction"),
        ("nehru_place", "Nehru Place Commercial Hub", 28.5490, 77.2520, 218.0, 4200, "junction"),
        ("kalkaji_mandir_metro", "Kalkaji Mandir Interchange", 28.5500, 77.2600, 217.0, 3700, "junction"),
        ("modi_mill_flyover", "Modi Mill Flyover Okhla", 28.5580, 77.2680, 215.0, 3600, "junction"),
        ("fortis_escorts_okhla", "Fortis Escorts Heart Institute Okhla", 28.5600, 77.2740, 214.0, 4200, "hospital"),
    ])
    add_edge("moolchand_underpass", "chirag_delhi_flyover")
    add_edge("lajpat_nagar", "nehru_place")

    add_corridor([
        ("pragati_maidan_east", "Pragati Maidan Ring Road Bypass", 28.6180, 77.2540, 213.0, 3200, "junction"),
        ("sunder_nagar_zoo", "Sunder Nagar / Delhi Zoo", 28.6020, 77.2440, 214.0, 3200, "junction"),
        ("hazrat_nizamuddin", "Hazrat Nizamuddin Railway Station", 28.5880, 77.2530, 213.0, 4500, "railway"),
        ("ashram_flyover", "Ashram Chowk Flyover Junction", 28.5720, 77.2590, 215.5, 4000, "junction"),
        ("new_friends_colony", "New Friends Colony Mathura Rd", 28.5630, 77.2690, 214.5, 3300, "junction"),
        ("fortis_escorts_okhla", "Fortis Escorts Heart Institute Okhla", 28.5600, 77.2740, 214.0, 4200, "hospital"),
        ("holy_family_hospital", "Holy Family Hospital Okhla", 28.5620, 77.2780, 213.8, 3600, "hospital"),
        ("apollo_hospital_sarita_vihar", "Indraprastha Apollo Hospital Sarita Vihar", 28.5390, 77.2880, 215.0, 4800, "hospital"),
        ("sarita_vihar_crossing", "Sarita Vihar Underpass Crossing", 28.5320, 77.2910, 213.5, 3400, "junction"),
        ("mohan_cooperative", "Mohan Cooperative Industrial Area", 28.5210, 77.2960, 214.0, 3300, "junction"),
        ("badarpur_border_junction", "Badarpur Metro / Mehrauli Rd", 28.5080, 77.3010, 214.5, 3800, "junction"),
        ("pul_prahladpur_sag", "Pul Prahladpur Underpass Sag", 28.5120, 77.2920, 208.5, 4300, "sag"),
    ])
    add_edge("fortis_escorts_okhla", "holy_family_hospital")
    add_edge("badarpur_border_junction", "pul_prahladpur_sag")

    add_corridor([
        ("saket_district_centre", "Select Citywalk / Saket DC", 28.5280, 77.2190, 223.5, 3900, "junction"),
        ("khanpur_chowk", "Khanpur T-Point / MB Road", 28.5210, 77.2380, 220.0, 3600, "junction"),
        ("batra_hospital", "Batra Hospital & Medical Research", 28.5180, 77.2500, 218.0, 3800, "hospital"),
        ("sangam_vihar_crossing", "Sangam Vihar MB Road Entry", 28.5150, 77.2650, 216.0, 3700, "junction"),
        ("pul_prahladpur_sag", "Pul Prahladpur Underpass Sag", 28.5120, 77.2920, 208.5, 4300, "sag"),
    ])
    add_edge("khanpur_chowk", "batra_hospital")

    # ═════════════════════════════════════════════════════════════════
    # 13. EAST DELHI & TRANS-YAMUNA CORRIDOR (Vikas Marg, Akshardham, Anand Vihar, GTB)
    # ═════════════════════════════════════════════════════════════════
    add_corridor([
        ("ito_junction", "ITO Junction (BSZ Marg)", 28.6285, 77.2410, 214.2, 3800, "junction"),
        ("ito_yamuna_bridge", "ITO Yamuna Barrage Bridge", 28.6295, 77.2520, 213.5, 3000, "junction"),
        ("shakarpur_crossing", "Shakarpur Vikas Marg Crossing", 28.6300, 77.2680, 213.0, 3200, "junction"),
        ("laxmi_nagar_chowk", "Laxmi Nagar Vikas Marg Chowk", 28.6305, 77.2770, 213.2, 4000, "junction"),
        ("nirman_vihar_metro", "Nirman Vihar Metro Hub", 28.6360, 77.2880, 214.0, 3400, "junction"),
        ("preet_vihar_chowk", "Preet Vihar Vikas Marg", 28.6410, 77.2960, 214.5, 3500, "junction"),
        ("karkardooma_court", "Karkardooma District Courts", 28.6490, 77.3030, 215.0, 3800, "junction"),
        ("anand_vihar_isbt", "Anand Vihar ISBT & Railway Terminal", 28.6470, 77.3150, 214.0, 4900, "railway"),
    ])

    add_corridor([
        ("ito_yamuna_bridge", "ITO Yamuna Barrage Bridge", 28.6295, 77.2520, 213.5, 3000, "junction"),
        ("nh9_akshardham_entry", "NH-9 Akshardham Entry Flyover", 28.6180, 77.2720, 212.5, 3600, "junction"),
        ("akshardham_junction", "Akshardham Temple NH-9 Junction", 28.6130, 77.2780, 213.0, 4200, "junction"),
        ("mayur_vihar_phase1", "Mayur Vihar Phase 1 Metro / Link Rd", 28.6040, 77.2910, 213.5, 3800, "junction"),
        ("chilla_border_noida", "Chilla Border (Delhi-Noida Link)", 28.5920, 77.3050, 214.0, 3600, "junction"),
        ("max_hospital_patparganj", "Max Super Speciality Patparganj", 28.6300, 77.3080, 214.5, 4200, "hospital"),
        ("anand_vihar_isbt", "Anand Vihar ISBT & Railway Terminal", 28.6470, 77.3150, 214.0, 4900, "railway"),
    ])
    add_edge("shakarpur_crossing", "akshardham_junction")
    add_edge("laxmi_nagar_chowk", "max_hospital_patparganj")

    add_corridor([
        ("anand_vihar_isbt", "Anand Vihar ISBT & Railway Terminal", 28.6470, 77.3150, 214.0, 4900, "railway"),
        ("seemapuri_border", "Seemapuri Border Crossing", 28.6720, 77.3220, 215.0, 3500, "junction"),
        ("dilshad_garden_metro", "Dilshad Garden Metro Station", 28.6760, 77.3180, 215.5, 3400, "junction"),
        ("gtb_hospital_shahdara", "GTB Hospital & UCMS Shahdara", 28.6840, 77.3120, 214.5, 4800, "hospital"),
        ("shahdara_flyover", "Shahdara GT Road Flyover", 28.6730, 77.2900, 214.0, 3600, "junction"),
        ("shastri_park_metro", "Shastri Park Metro / GT Road", 28.6680, 77.2620, 213.5, 3500, "junction"),
        ("kashmere_gate_sag", "Kashmere Gate Ring Road Sag", 28.6640, 77.2340, 211.8, 3600, "sag"),
    ])
    add_edge("shastri_park_metro", "delhi_gate")
    add_edge("shahdara_flyover", "laxmi_nagar_chowk")
    add_edge("sarai_kale_khan_isbt", "hazrat_nizamuddin")

    # ═════════════════════════════════════════════════════════════════
    # 13B. SMALL-WIDTH ROADS, DETOUR ALLEYS & SERVICE LANES (56 NODES)
    # ═════════════════════════════════════════════════════════════════

    # --- 1. CP Middle Circle & Inner Alleys (8 nodes) ---
    add_corridor([
        ("cp_mid_lane_n", "CP Middle Circle North Alley", 28.6338, 77.2185, 215.2, 1400, "junction"),
        ("cp_mid_lane_ne", "CP Middle Circle Barakhamba Alley", 28.6332, 77.2205, 215.1, 1400, "junction"),
        ("cp_mid_lane_e", "CP Middle Circle KG Marg Alley", 28.6318, 77.2215, 215.0, 1500, "junction"),
        ("cp_mid_lane_se", "CP Middle Circle Janpath Alley", 28.6298, 77.2208, 215.2, 1500, "junction"),
        ("cp_mid_lane_s", "CP Middle Circle Sansad Marg Alley", 28.6290, 77.2188, 215.3, 1400, "junction"),
        ("cp_mid_lane_sw", "CP Middle Circle Baba Kharak Singh Alley", 28.6298, 77.2162, 215.2, 1400, "junction"),
        ("cp_mid_lane_w", "CP Middle Circle Shaheed Bhagat Alley", 28.6318, 77.2152, 215.1, 1400, "junction"),
        ("cp_mid_lane_nw", "CP Middle Circle Chelmsford Alley", 28.6332, 77.2162, 215.2, 1400, "junction"),
        ("cp_mid_lane_n", "CP Middle Circle North Alley", 28.6338, 77.2185, 215.2, 1400, "junction"),
    ])
    add_edge("cp_mid_lane_n", "cp_outer_n")
    add_edge("cp_mid_lane_ne", "cp_outer_ne")
    add_edge("cp_mid_lane_e", "cp_outer_e")
    add_edge("cp_mid_lane_se", "cp_outer_se")
    add_edge("cp_mid_lane_s", "cp_outer_s")
    add_edge("cp_mid_lane_sw", "cp_outer_sw")
    add_edge("cp_mid_lane_w", "cp_outer_w")
    add_edge("cp_mid_lane_nw", "cp_outer_nw")
    add_edge("cp_mid_lane_n", "cp_inner")
    add_edge("cp_mid_lane_s", "cp_inner")
    add_edge("cp_mid_lane_e", "cp_inner")
    add_edge("cp_mid_lane_w", "cp_inner")

    # --- 2. Minto Bridge Detour & Rouse Backlanes (6 nodes) ---
    add_corridor([
        ("thompson_road_lane", "Thompson Road Rail Bypass Lane", 28.6310, 77.2202, 214.8, 1200, "junction"),
        ("rouse_avenue_backlane", "Rouse Avenue Backlane", 28.6288, 77.2220, 214.5, 1300, "junction"),
        ("chaman_lal_lane", "Chaman Lal Marg Institutional Lane", 28.6305, 77.2240, 215.0, 1400, "junction"),
        ("school_lane_minto", "School Lane Bridge Connector", 28.6320, 77.2222, 215.2, 1500, "junction"),
    ])
    add_corridor([
        ("press_enclave_lane_cp", "Press Road Media Enclave Lane", 28.6265, 77.2225, 215.0, 1300, "junction"),
        ("mir_dard_road_lane", "Mir Dard Road Detour Lane", 28.6272, 77.2260, 214.7, 1400, "junction"),
    ])
    add_edge("thompson_road_lane", "minto_north")
    add_edge("rouse_avenue_backlane", "ddu_marg_east")
    add_edge("press_enclave_lane_cp", "tagore_road")
    add_edge("mir_dard_road_lane", "ddu_marg_east")
    add_edge("school_lane_minto", "barakhamba_mid")
    add_edge("chaman_lal_lane", "barakhamba_mid")
    add_edge("thompson_road_lane", "rouse_avenue_backlane")
    add_edge("rouse_avenue_backlane", "press_enclave_lane_cp")

    # --- 3. Bengali Market & Babar Road Bypass Grid (6 nodes) ---
    add_corridor([
        ("babar_road_north", "Babar Road North Alley", 28.6280, 77.2270, 215.4, 1300, "junction"),
        ("babar_road_mid", "Babar Road Central Bypass", 28.6260, 77.2285, 215.3, 1400, "junction"),
        ("babar_road_south", "Babar Road South Connector", 28.6240, 77.2300, 215.2, 1300, "junction"),
    ])
    add_corridor([
        ("todarmal_lane", "Todarmal Lane Cultural Bypass", 28.6270, 77.2295, 215.3, 1200, "junction"),
        ("bengali_market_alley", "Bengali Market Internal Service Alley", 28.6262, 77.2312, 215.2, 1100, "junction"),
        ("tansen_marg_lane", "Tansen Marg Service Connector", 28.6250, 77.2320, 215.1, 1300, "junction"),
    ])
    add_edge("babar_road_north", "mandi_house")
    add_edge("babar_road_south", "mandi_house_e")
    add_edge("todarmal_lane", "mandi_house_w")
    add_edge("bengali_market_alley", "mandi_house_s")
    add_edge("tansen_marg_lane", "mandi_house")
    add_edge("babar_road_mid", "todarmal_lane")
    add_edge("todarmal_lane", "bengali_market_alley")
    add_edge("bengali_market_alley", "tansen_marg_lane")

    # --- 4. Janpath & Tolstoy Service Corridors (6 nodes) ---
    add_corridor([
        ("tolstoy_lane_north", "Tolstoy Lane Parallel Slip Road", 28.6265, 77.2210, 215.5, 1400, "junction"),
        ("hailey_road_lane", "Hailey Road Heritage Alley", 28.6275, 77.2235, 215.4, 1300, "junction"),
        ("vakil_lane", "Vakil Lane Legal Enclave Connector", 28.6255, 77.2230, 215.3, 1200, "junction"),
        ("canning_lane", "Canning Lane Govt Officers Detour", 28.6225, 77.2250, 215.6, 1400, "junction"),
    ])
    add_corridor([
        ("janpath_lane_west", "Janpath West Cottage Industries Alley", 28.6240, 77.2170, 215.6, 1300, "junction"),
        ("janpath_lane_east", "Janpath East Hotel Backstreet", 28.6235, 77.2195, 215.5, 1400, "junction"),
    ])
    add_edge("janpath_lane_west", "janpath_tolstoy_crossing")
    add_edge("janpath_lane_east", "janpath_tolstoy_crossing")
    add_edge("tolstoy_lane_north", "janpath_tolstoy_crossing")
    add_edge("hailey_road_lane", "kg_marg_junction")
    add_edge("vakil_lane", "kg_marg_junction")
    add_edge("canning_lane", "windsor_place_circle")
    add_edge("janpath_lane_east", "tolstoy_lane_north")
    add_edge("vakil_lane", "canning_lane")

    # --- 5. Paharganj & NDLS Backlanes (6 nodes) ---
    add_corridor([
        ("main_bazar_paharganj", "Main Bazar Paharganj Pedestrian Alley", 28.6430, 77.2135, 216.0, 1100, "junction"),
        ("basant_road_lane", "Basant Road Railway Colony Lane", 28.6440, 77.2160, 215.8, 1300, "junction"),
        ("state_entry_road", "State Entry Road NDLS West Bypass", 28.6385, 77.2155, 215.5, 1600, "junction"),
        ("chelmsford_service_lane", "Chelmsford Service Lane Detour", 28.6365, 77.2170, 215.4, 1500, "junction"),
    ])
    add_corridor([
        ("db_gupta_road_lane", "DB Gupta Road Service Slip", 28.6465, 77.2105, 216.5, 1500, "junction"),
        ("aram_bagh_lane", "Aram Bagh Govt Colony Backlane", 28.6410, 77.2110, 216.2, 1300, "junction"),
    ])
    add_edge("main_bazar_paharganj", "paharganj_main_bazaar")
    add_edge("basant_road_lane", "ndls_paharganj")
    add_edge("state_entry_road", "chelmsford_road")
    add_edge("chelmsford_service_lane", "cp_outer_nw")
    add_edge("db_gupta_road_lane", "dbg_road_crossing")
    add_edge("aram_bagh_lane", "paharganj_main_bazaar")
    add_edge("aram_bagh_lane", "state_entry_road")
    add_edge("main_bazar_paharganj", "basant_road_lane")

    # --- 6. Daryaganj & Delhi Gate Heritage Lanes (6 nodes) ---
    add_corridor([
        ("netaji_subhash_service", "Netaji Subhash Marg Service Alley", 28.6475, 77.2395, 214.2, 1400, "junction"),
        ("ansari_road_daryaganj", "Ansari Road Publisher Market Lane", 28.6435, 77.2405, 214.0, 1300, "junction"),
        ("maha_lakshmi_lane", "Maha Lakshmi Layout Inner Lane", 28.6405, 77.2415, 214.1, 1200, "junction"),
        ("daryaganj_bypass", "Daryaganj Eastern Bypass Alley", 28.6380, 77.2425, 213.9, 1400, "junction"),
        ("delhi_gate_service", "Delhi Gate Heritage Slip Lane", 28.6360, 77.2410, 214.3, 1500, "junction"),
        ("kotla_firoz_lane", "Kotla Firoz Shah Perimeter Lane", 28.6325, 77.2430, 213.8, 1400, "junction"),
    ])
    add_edge("netaji_subhash_service", "red_fort_junction")
    add_edge("ansari_road_daryaganj", "netaji_subhash_marg")
    add_edge("maha_lakshmi_lane", "netaji_subhash_marg")
    add_edge("delhi_gate_service", "delhi_gate")
    add_edge("kotla_firoz_lane", "delhi_gate")
    add_edge("kotla_firoz_lane", "lnjp_hospital")

    # --- 7. Pragati Maidan & Mathura Road Secondary Lanes (6 nodes) ---
    add_corridor([
        ("bhagwan_das_lane", "Bhagwan Das Road Law Institute Lane", 28.6215, 77.2360, 215.2, 1300, "junction"),
        ("tilak_lane_connector", "Tilak Lane High Court Backroad", 28.6185, 77.2340, 215.3, 1400, "junction"),
        ("purana_qila_service", "Purana Qila Moat Service Road", 28.6085, 77.2410, 214.0, 1500, "junction"),
    ])
    add_corridor([
        ("kaka_nagar_service", "Kaka Nagar Residential Detour", 28.6015, 77.2355, 215.0, 1300, "junction"),
        ("golf_links_service", "Golf Links Perimeter Service Lane", 28.5960, 77.2315, 215.4, 1400, "junction"),
        ("sunder_nagar_service", "Sunder Nagar Market Internal Lane", 28.5980, 77.2420, 214.6, 1300, "junction"),
    ])
    add_edge("bhagwan_das_lane", "pragati_tunnel_entry_w")
    add_edge("tilak_lane_connector", "c_hexagon_ne")
    add_edge("purana_qila_service", "pragati_maidan_east")
    add_edge("kaka_nagar_service", "khan_market_metro")
    add_edge("golf_links_service", "khan_market_metro")
    add_edge("sunder_nagar_service", "pragati_maidan_east")
    add_edge("purana_qila_service", "sunder_nagar_service")
    add_edge("kaka_nagar_service", "golf_links_service")

    # --- 8. Karol Bagh & Pusa Road Parallel Detours (6 nodes) ---
    add_corridor([
        ("padam_singh_road", "Padam Singh Road Detour Alley", 28.6520, 77.1890, 218.0, 1300, "junction"),
        ("ajmal_khan_service", "Ajmal Khan Road Service Bypass", 28.6495, 77.1920, 217.8, 1400, "junction"),
        ("arya_samaj_lane", "Arya Samaj Road Inner Bypass", 28.6455, 77.1945, 217.5, 1400, "junction"),
        ("gurdwara_road_kb", "Gurdwara Road Karol Bagh Detour", 28.6430, 77.1915, 217.2, 1300, "junction"),
    ])
    add_corridor([
        ("ganga_ram_service_lane", "Sir Ganga Ram Hospital Service Lane", 28.6395, 77.1910, 217.0, 1500, "junction"),
        ("rajendra_nagar_lane", "Old Rajendra Nagar Detour Lane", 28.6365, 77.1870, 217.4, 1300, "junction"),
    ])
    add_edge("padam_singh_road", "karol_bagh")
    add_edge("ajmal_khan_service", "ajmal_khan_road")
    add_edge("arya_samaj_lane", "jhandewalan_mandir")
    add_edge("gurdwara_road_kb", "karol_bagh")
    add_edge("ganga_ram_service_lane", "ganga_ram_hospital")
    add_edge("rajendra_nagar_lane", "karol_bagh")
    add_edge("gurdwara_road_kb", "ganga_ram_service_lane")
    add_edge("ganga_ram_service_lane", "rajendra_nagar_lane")

    # --- 9. Lajpat Nagar & South Ring Road Inner Lanes (6 nodes) ---
    add_corridor([
        ("defence_colony_flyover_service", "Defence Colony Under-Flyover Slip", 28.5750, 77.2340, 216.5, 1500, "junction"),
        ("firoz_gandhi_road_lane", "Firoz Gandhi Road Detour Lane", 28.5720, 77.2440, 216.0, 1400, "junction"),
        ("lajpat_central_market_lane", "Lajpat Nagar Central Market Bypass", 28.5695, 77.2415, 215.8, 1200, "junction"),
        ("moolchand_service_road", "Moolchand Underpass Service Lane", 28.5670, 77.2360, 216.2, 1600, "junction"),
    ])
    add_corridor([
        ("ring_road_service_south", "South Ring Road Parallel Service Lane", 28.5685, 77.2280, 216.8, 1600, "junction"),
        ("safdarjung_enclave_lane", "Safdarjung Enclave Bypass Corridor", 28.5640, 77.2020, 217.5, 1400, "junction"),
    ])
    add_edge("defence_colony_flyover_service", "lajpat_nagar")
    add_edge("firoz_gandhi_road_lane", "lajpat_nagar")
    add_edge("lajpat_central_market_lane", "lajpat_nagar")
    add_edge("moolchand_service_road", "moolchand_hospital")
    add_edge("ring_road_service_south", "aiims_delhi")
    add_edge("safdarjung_enclave_lane", "safdarjung_hospital")
    add_edge("moolchand_service_road", "ring_road_service_south")

    # ═════════════════════════════════════════════════════════════════
    # 13C. DEDICATED NAVIGATION & ACCESS CLUSTERS FOR TOP 15 HOSPITALS
    # ═════════════════════════════════════════════════════════════════

    # --- 1. AIIMS New Delhi Trauma Cluster ---
    add_corridor([
        ("aiims_emergency_gate", "AIIMS Emergency & Trauma Ramp", 28.5678, 77.2108, 217.5, 1200, "junction"),
        ("aiims_opd_circulatory", "AIIMS OPD Circular Bypass", 28.5665, 77.2095, 217.4, 1300, "junction"),
        ("aiims_trauma_service_rd", "AIIMS Trauma Centre Ring Road Service Lane", 28.5682, 77.2125, 217.2, 1400, "junction"),
        ("aiims_flyover_slip_w", "AIIMS Flyover West Descent Slip", 28.5670, 77.2080, 217.0, 1500, "junction"),
    ])
    add_edge("aiims_emergency_gate", "aiims_delhi")
    add_edge("aiims_opd_circulatory", "aiims_delhi")
    add_edge("aiims_trauma_service_rd", "aiims_delhi")
    add_edge("aiims_flyover_slip_w", "aiims_delhi")
    add_edge("aiims_trauma_service_rd", "south_extension")
    add_edge("aiims_flyover_slip_w", "safdarjung_hospital")

    # --- 2. Safdarjung Hospital Emergency Access ---
    add_corridor([
        ("safdarjung_emergency_ramp", "Safdarjung Emergency Triage Ramp", 28.5692, 77.2052, 217.2, 1200, "junction"),
        ("safdarjung_gate_1", "Safdarjung Gate 1 Main Access", 28.5680, 77.2045, 217.3, 1300, "junction"),
        ("safdarjung_ringroad_slip", "Safdarjung Ring Road Service Detour", 28.5698, 77.2070, 217.0, 1400, "junction"),
    ])
    add_edge("safdarjung_emergency_ramp", "safdarjung_hospital")
    add_edge("safdarjung_gate_1", "safdarjung_hospital")
    add_edge("safdarjung_ringroad_slip", "safdarjung_hospital")
    add_edge("safdarjung_ringroad_slip", "aiims_emergency_gate")
    add_edge("safdarjung_gate_1", "safdarjung_enclave_entry")

    # --- 3. Dr. RML Hospital CP West Cluster ---
    add_corridor([
        ("rml_emergency_ramp", "RML Emergency Triage Ingress", 28.6242, 77.1990, 218.0, 1200, "junction"),
        ("rml_baba_kharak_gate", "RML Baba Kharak Singh Gate", 28.6248, 77.2015, 217.8, 1300, "junction"),
        ("rml_talkatora_feeder", "RML Talkatora Road Bypass", 28.6225, 77.1980, 218.4, 1400, "junction"),
    ])
    add_edge("rml_emergency_ramp", "rml_hospital")
    add_edge("rml_baba_kharak_gate", "rml_hospital")
    add_edge("rml_talkatora_feeder", "rml_hospital")
    add_edge("rml_baba_kharak_gate", "goldak_w")
    add_edge("rml_talkatora_feeder", "talkatora_garden")

    # --- 4. LNJP & GB Pant Hospital Heritage Corridor ---
    add_corridor([
        ("lnjp_emergency_gate", "LNJP Main Emergency Ingress", 28.6378, 77.2420, 213.6, 1200, "junction"),
        ("lnjp_jln_marg_slip", "JLN Marg LNJP Service Road", 28.6365, 77.2415, 213.8, 1400, "junction"),
        ("gb_pant_cardiac_gate", "GB Pant Cardiac Emergency Gate", 28.6350, 77.2440, 213.9, 1200, "junction"),
        ("bsz_hospital_corridor", "BSZ Marg Medical Link Corridor", 28.6340, 77.2420, 214.0, 1300, "junction"),
    ])
    add_edge("lnjp_emergency_gate", "lnjp_hospital")
    add_edge("lnjp_jln_marg_slip", "lnjp_hospital")
    add_edge("gb_pant_cardiac_gate", "gb_pant_hospital")
    add_edge("bsz_hospital_corridor", "gb_pant_hospital")
    add_edge("lnjp_emergency_gate", "delhi_gate")
    add_edge("bsz_hospital_corridor", "bsz_marg_mid")
    add_edge("gb_pant_hospital", "lnjp_hospital")

    # --- 5. Sir Ganga Ram & BLK-Max Hospital West Grid ---
    add_corridor([
        ("ganga_ram_emergency_ramp", "Sir Ganga Ram Emergency Access", 28.6390, 77.1902, 218.8, 1200, "junction"),
        ("ganga_ram_pusa_connector", "Ganga Ram Pusa Road Link", 28.6415, 77.1885, 218.6, 1300, "junction"),
        ("blkapoor_emergency_ingress", "BLK-Max Emergency Ingress", 28.6458, 77.1812, 218.4, 1200, "junction"),
        ("blkapoor_pusa_slip", "BLK-Max Pusa Road Service Lane", 28.6442, 77.1830, 218.3, 1400, "junction"),
    ])
    add_edge("ganga_ram_emergency_ramp", "ganga_ram_hospital")
    add_edge("ganga_ram_pusa_connector", "ganga_ram_hospital")
    add_edge("blkapoor_emergency_ingress", "blkapoor_hospital")
    add_edge("blkapoor_pusa_slip", "blkapoor_hospital")
    add_edge("ganga_ram_pusa_connector", "karol_bagh")
    add_edge("blkapoor_pusa_slip", "rajendra_place")
    add_edge("ganga_ram_hospital", "blkapoor_hospital")

    # --- 6. Lady Hardinge Medical College Radial ---
    add_corridor([
        ("lady_hardinge_emergency", "Lady Hardinge Trauma & Delivery Gate", 28.6330, 77.2140, 216.1, 1200, "junction"),
        ("lady_hardinge_cp_feeder", "Lady Hardinge CP Outer Connector", 28.6320, 77.2145, 216.3, 1300, "junction"),
        ("lady_hardinge_panchkuian_lane", "Lady Hardinge Panchkuian Service Lane", 28.6335, 77.2110, 216.4, 1400, "junction"),
    ])
    add_edge("lady_hardinge_emergency", "lady_hardinge")
    add_edge("lady_hardinge_cp_feeder", "lady_hardinge")
    add_edge("lady_hardinge_panchkuian_lane", "lady_hardinge")
    add_edge("lady_hardinge_cp_feeder", "cp_outer_w")
    add_edge("lady_hardinge_panchkuian_lane", "panchkuian_road_1")

    # --- 7. Max Super Speciality Hospital Saket Cluster ---
    add_corridor([
        ("max_saket_emergency_bay", "Max Saket Emergency Ambulance Bay", 28.5278, 77.2132, 224.0, 1200, "junction"),
        ("max_saket_press_enclave_rd", "Press Enclave Road Hospital Access", 28.5265, 77.2155, 223.8, 1400, "junction"),
        ("max_saket_citywalk_feeder", "Select Citywalk / Max Link Road", 28.5275, 77.2175, 223.6, 1300, "junction"),
    ])
    add_edge("max_saket_emergency_bay", "max_hospital_saket")
    add_edge("max_saket_press_enclave_rd", "max_hospital_saket")
    add_edge("max_saket_citywalk_feeder", "max_hospital_saket")
    add_edge("max_saket_press_enclave_rd", "saket_city_hospital")
    add_edge("max_saket_citywalk_feeder", "saket_district_centre")

    # --- 8. Moolchand Medcity South Hub ---
    add_corridor([
        ("moolchand_emergency_bay", "Moolchand Emergency Triage Ramp", 28.5655, 77.2348, 216.3, 1200, "junction"),
        ("moolchand_lala_lajpat_slip", "Lala Lajpat Rai Marg Service Lane", 28.5645, 77.2335, 216.1, 1400, "junction"),
        ("moolchand_defcol_feeder", "Defence Colony - Moolchand Detour", 28.5662, 77.2365, 216.0, 1300, "junction"),
    ])
    add_edge("moolchand_emergency_bay", "moolchand_hospital")
    add_edge("moolchand_lala_lajpat_slip", "moolchand_hospital")
    add_edge("moolchand_defcol_feeder", "moolchand_hospital")
    add_edge("moolchand_lala_lajpat_slip", "moolchand_underpass")
    add_edge("moolchand_defcol_feeder", "south_extension")

    # --- 9. Fortis Escorts & Holy Family Hospital Southeast Grid ---
    add_corridor([
        ("fortis_escorts_emergency_bay", "Fortis Escorts Cardiac Ambulance Ramp", 28.5608, 77.2732, 214.1, 1200, "junction"),
        ("fortis_okhla_mathura_slip", "Mathura Road Fortis Service Road", 28.5595, 77.2720, 214.3, 1400, "junction"),
        ("holy_family_emergency_gate", "Holy Family Emergency Gate", 28.5628, 77.2772, 213.9, 1200, "junction"),
        ("holy_family_okhla_bypass", "Okhla Road - Holy Family Detour", 28.5615, 77.2790, 213.7, 1300, "junction"),
    ])
    add_edge("fortis_escorts_emergency_bay", "fortis_escorts_okhla")
    add_edge("fortis_okhla_mathura_slip", "fortis_escorts_okhla")
    add_edge("holy_family_emergency_gate", "holy_family_hospital")
    add_edge("holy_family_okhla_bypass", "holy_family_hospital")
    add_edge("fortis_okhla_mathura_slip", "modi_mill_flyover")
    add_edge("holy_family_okhla_bypass", "new_friends_colony")
    add_edge("fortis_escorts_okhla", "holy_family_emergency_gate")

    # --- 10. Indraprastha Apollo Hospital Sarita Vihar Corridor ---
    add_corridor([
        ("apollo_emergency_ramp", "Apollo Emergency Trauma Ramp", 28.5398, 77.2872, 215.1, 1200, "junction"),
        ("apollo_mathura_road_service", "Mathura Road Apollo Service Corridor", 28.5410, 77.2860, 214.8, 1400, "junction"),
        ("apollo_jasola_link", "Jasola - Apollo Link Road", 28.5380, 77.2895, 214.5, 1300, "junction"),
    ])
    add_edge("apollo_emergency_ramp", "apollo_hospital_sarita_vihar")
    add_edge("apollo_mathura_road_service", "apollo_hospital_sarita_vihar")
    add_edge("apollo_jasola_link", "apollo_hospital_sarita_vihar")
    add_edge("apollo_mathura_road_service", "sarita_vihar_crossing")
    add_edge("apollo_jasola_link", "mohan_cooperative")

    # --- 11. GTB Hospital & UCMS Shahdara Ingress ---
    add_corridor([
        ("gtb_emergency_trauma_bay", "GTB Hospital Emergency & Trauma Entry", 28.6848, 77.3112, 214.6, 1200, "junction"),
        ("gtb_ucms_campus_feeder", "UCMS Campus Outer Service Ring", 28.6835, 77.3130, 214.4, 1300, "junction"),
        ("gtb_tahirpur_road_link", "Tahirpur Road Hospital Detour", 28.6820, 77.3100, 214.7, 1300, "junction"),
    ])
    add_edge("gtb_emergency_trauma_bay", "gtb_hospital_shahdara")
    add_edge("gtb_ucms_campus_feeder", "gtb_hospital_shahdara")
    add_edge("gtb_tahirpur_road_link", "gtb_hospital_shahdara")
    add_edge("gtb_tahirpur_road_link", "shahdara_flyover")
    add_edge("gtb_ucms_campus_feeder", "dilshad_garden_metro")

    # --- 12. Max Super Speciality Hospital Patparganj Ingress ---
    add_corridor([
        ("max_patparganj_emergency_bay", "Max Patparganj Emergency Ingress", 28.6308, 77.3072, 214.6, 1200, "junction"),
        ("max_patparganj_ip_ext_lane", "IP Extension Parallel Service Road", 28.6292, 77.3090, 214.4, 1400, "junction"),
        ("max_patparganj_madhu_vihar", "Madhu Vihar Road Access", 28.6315, 77.3055, 214.3, 1300, "junction"),
    ])
    add_edge("max_patparganj_emergency_bay", "max_hospital_patparganj")
    add_edge("max_patparganj_ip_ext_lane", "max_hospital_patparganj")
    add_edge("max_patparganj_madhu_vihar", "max_hospital_patparganj")
    add_edge("max_patparganj_ip_ext_lane", "anand_vihar_isbt")
    add_edge("max_patparganj_madhu_vihar", "laxmi_nagar_chowk")

    # ═════════════════════════════════════════════════════════════════
    # 13D. ULTRA-DENSE 10 KM RADIUS URBAN STREET MESH (6,300+ NODES)
    # ═════════════════════════════════════════════════════════════════
    center_lat, center_lon = 28.6315, 77.2167  # Rajiv Chowk Central Benchmark
    radius_m = 10000.0
    lat_step = 0.0020  # ~220 meters
    lon_step = 0.0023  # ~220 meters

    def get_mesh_zone_name(lat, lon):
        if 28.625 <= lat <= 28.640 and 77.210 <= lon <= 77.230:
            return "Connaught Place Radial Alley"
        elif 28.638 <= lat <= 28.655 and 77.205 <= lon <= 77.225:
            return "Paharganj / NDLS Area Lane"
        elif 28.635 <= lat <= 28.665 and 77.225 <= lon <= 77.250:
            return "Old Delhi / Daryaganj Backlane"
        elif 28.665 <= lat <= 28.700 and 77.215 <= lon <= 77.245:
            return "Civil Lines / Sham Nath Marg St"
        elif lat > 28.690:
            return "North Delhi / GT Karnal Feeder"
        elif 28.630 <= lat <= 28.660 and 77.170 <= lon <= 77.205:
            return "Karol Bagh / Rajendra Nagar Alley"
        elif 28.635 <= lat <= 28.665 and 77.135 <= lon <= 77.170:
            return "Patel Nagar / Kirti Nagar Road"
        elif lon < 77.135:
            return "West Delhi / Ring Road Feeder"
        elif 28.585 <= lat <= 28.620 and 77.180 <= lon <= 77.210:
            return "Chanakyapuri / Diplomatic Enclave"
        elif 28.570 <= lat <= 28.610 and 77.130 <= lon <= 77.180:
            return "Dhaula Kuan / Cantt Connector"
        elif 28.580 <= lat <= 28.615 and 77.210 <= lon <= 77.240:
            return "Lodhi Estate / Khan Market St"
        elif 28.610 <= lat <= 28.630 and 77.225 <= lon <= 77.250:
            return "India Gate / Pragati Maidan Lane"
        elif 28.555 <= lat <= 28.580 and 77.190 <= lon <= 77.225:
            return "AIIMS / South Extension Inner Rd"
        elif 28.560 <= lat <= 28.585 and 77.225 <= lon <= 77.250:
            return "Defence Colony / Lajpat Nagar St"
        elif 28.550 <= lat <= 28.595 and 77.250 <= lon <= 77.280:
            return "Ashram / Nizamuddin / Okhla St"
        elif lat < 28.555 and lon <= 77.225:
            return "Hauz Khas / Saket Feeder Road"
        elif 28.530 <= lat <= 28.560 and 77.225 <= lon <= 77.265:
            return "Nehru Place / GK Service Road"
        elif lat < 28.545 and lon > 77.265:
            return "Sarita Vihar / Apollo Sector St"
        elif 28.620 <= lat <= 28.650 and 77.250 <= lon <= 77.300:
            return "Laxmi Nagar / Vikas Marg Backroad"
        elif 28.585 <= lat <= 28.620 and lon > 77.250:
            return "Mayur Vihar / Akshardham Slip"
        elif 28.625 <= lat <= 28.660 and lon > 77.295:
            return "Anand Vihar / Patparganj Lane"
        elif lat > 28.660 and lon > 77.270:
            return "Shahdara / GTB Hospital Feeder"
        else:
            return "Delhi Urban Sector Street"

    def get_mesh_elev(lat, lon):
        base = 216.0
        if lon < 77.200:
            base += (77.200 - lon) * 65.0
        elif lon > 77.240:
            base -= (lon - 77.240) * 45.0
        if lat < 28.600:
            base += (28.600 - lat) * 40.0
        var = math.sin(lat * 500) * math.cos(lon * 500) * 1.5
        return round(max(209.0, min(235.0, base + var)), 1)

    mesh_coords = {}
    for i in range(-48, 49):
        for j in range(-48, 49):
            m_lat = center_lat + i * lat_step
            m_lon = center_lon + j * lon_step
            dist_to_center = haversine(center_lat, center_lon, m_lat, m_lon)
            if dist_to_center <= radius_m:
                node_id = f"mesh_{i+48}_{j+48}"
                zone_name = get_mesh_zone_name(m_lat, m_lon)
                m_name = f"{zone_name} (Grid {i+48}-{j+48})"
                m_elev = get_mesh_elev(m_lat, m_lon)
                add_node(node_id, m_name, m_lat, m_lon, m_elev, 2800, "junction")
                mesh_coords[(i, j)] = (node_id, m_lat, m_lon)

    # Interconnect mesh nodes (Horizontal and Vertical grid)
    for (i, j), (u_id, u_lat, u_lon) in mesh_coords.items():
        if (i, j + 1) in mesh_coords:
            v_id, _, _ = mesh_coords[(i, j + 1)]
            add_edge(u_id, v_id, diameter=0.8)
        if (i + 1, j) in mesh_coords:
            v_id, _, _ = mesh_coords[(i + 1, j)]
            add_edge(u_id, v_id, diameter=0.8)

    # Stitch existing landmark and corridor nodes to the nearest mesh nodes (<= 350m)
    existing_landmark_ids = [nid for nid in nodes if not nid.startswith("mesh_")]
    for l_id in existing_landmark_ids:
        l_node = nodes[l_id]
        l_lat, l_lon = l_node["lat"], l_node["lon"]
        connected_count = 0
        for (i, j), (m_id, m_lat, m_lon) in mesh_coords.items():
            d = haversine(l_lat, l_lon, m_lat, m_lon)
            if d <= 350.0:
                add_edge(l_id, m_id, diameter=0.9)
                connected_count += 1
                if connected_count >= 4:
                    break
                    break

    # ═════════════════════════════════════════════════════════════════
    # 14. DENSE REALISTIC POTHOLE HAZARDS (>= 2 on EVERY street near Minto)
    # ═════════════════════════════════════════════════════════════════
    potholes = [
        # --- 1. Minto Road North & South Corridors (6 potholes) ---
        {"id": "ph_minto_north_1", "name": "Minto Road North Ingress Fissure", "lat": 28.6292, "lon": 77.2196, "severity": "MODERATE", "depth_cm": 10.5, "road": "Minto Road North"},
        {"id": "ph_minto_north_2", "name": "Minto Road Railway Under-Ramp Dip", "lat": 28.6298, "lon": 77.2194, "severity": "MODERATE", "depth_cm": 12.0, "road": "Minto Road North"},
        {"id": "ph_minto_sag_1", "name": "Minto Underpass Central Dip Crater", "lat": 28.6281, "lon": 77.2198, "severity": "SEVERE", "depth_cm": 18.0, "road": "Minto Bridge Underpass"},
        {"id": "ph_minto_sag_2", "name": "Minto Underpass Storm Sump Subsidence", "lat": 28.6279, "lon": 77.2196, "severity": "SEVERE", "depth_cm": 16.5, "road": "Minto Bridge Underpass"},
        {"id": "ph_minto_south_1", "name": "Minto Road South Curve Depression", "lat": 28.6267, "lon": 77.2199, "severity": "MODERATE", "depth_cm": 11.0, "road": "Minto Road South"},
        {"id": "ph_minto_south_2", "name": "Minto Road / Tagore Junction Pavement Break", "lat": 28.6258, "lon": 77.2202, "severity": "SEVERE", "depth_cm": 13.5, "road": "Minto Road South"},

        # --- 2. DDU Marg West & East (4 potholes) ---
        {"id": "ph_ddu_west_1", "name": "DDU Marg West Drainage Trench", "lat": 28.6276, "lon": 77.2172, "severity": "SEVERE", "depth_cm": 14.0, "road": "DDU Marg West"},
        {"id": "ph_ddu_west_2", "name": "DDU Marg West / CP Outer Shoulder Dip", "lat": 28.6282, "lon": 77.2166, "severity": "MODERATE", "depth_cm": 11.5, "road": "DDU Marg West"},
        {"id": "ph_ddu_east_1", "name": "DDU Marg East Rouse Avenue Crater", "lat": 28.6283, "lon": 77.2225, "severity": "SEVERE", "depth_cm": 15.0, "road": "DDU Marg East"},
        {"id": "ph_ddu_east_2", "name": "DDU Marg East Institutional Area Gully Pit", "lat": 28.6284, "lon": 77.2310, "severity": "MODERATE", "depth_cm": 12.5, "road": "DDU Marg East"},

        # --- 3. Barakhamba Road Corridor (2 potholes) ---
        {"id": "ph_barakhamba_1", "name": "Barakhamba Road Metro Entry Rut", "lat": 28.6312, "lon": 77.2215, "severity": "MODERATE", "depth_cm": 11.0, "road": "Barakhamba Road"},
        {"id": "ph_barakhamba_2", "name": "Barakhamba Road / Tolstoy Crossing Bitumen Depression", "lat": 28.6304, "lon": 77.2245, "severity": "SEVERE", "depth_cm": 13.0, "road": "Barakhamba Road"},

        # --- 4. Connaught Place Outer Circle (4 potholes) ---
        {"id": "ph_cp_outer_n_1", "name": "CP Outer Circle North Radial Crack", "lat": 28.6342, "lon": 77.2173, "severity": "MODERATE", "depth_cm": 9.5, "road": "CP Outer Circle"},
        {"id": "ph_cp_outer_n_2", "name": "CP Outer Circle / Minto Ingress Pit", "lat": 28.6335, "lon": 77.2185, "severity": "MODERATE", "depth_cm": 10.5, "road": "CP Outer Circle"},
        {"id": "ph_cp_outer_s_1", "name": "CP Outer Circle South / Janpath Fissure", "lat": 28.6288, "lon": 77.2158, "severity": "SEVERE", "depth_cm": 12.0, "road": "CP Outer Circle"},
        {"id": "ph_cp_outer_s_2", "name": "CP Outer Circle / Sansad Marg Dip", "lat": 28.6285, "lon": 77.2145, "severity": "MODERATE", "depth_cm": 11.0, "road": "CP Outer Circle"},

        # --- 5. Chelmsford Road & Bhavbhuti Marg (NDLS Approach) (4 potholes) ---
        {"id": "ph_chelmsford_1", "name": "Chelmsford Road Rail Colony Pit", "lat": 28.6388, "lon": 77.2172, "severity": "SEVERE", "depth_cm": 12.0, "road": "Chelmsford Road"},
        {"id": "ph_chelmsford_2", "name": "Chelmsford Road Bus Bay Rut", "lat": 28.6395, "lon": 77.2178, "severity": "MODERATE", "depth_cm": 10.0, "road": "Chelmsford Road"},
        {"id": "ph_ndls_ajmeri_1", "name": "NDLS Ajmeri Gate Bus Terminal Trench", "lat": 28.6422, "lon": 77.2212, "severity": "SEVERE", "depth_cm": 15.5, "road": "Bhavbhuti Marg"},
        {"id": "ph_ndls_ajmeri_2", "name": "NDLS Flyover Ramp Descent Pit", "lat": 28.6418, "lon": 77.2225, "severity": "SEVERE", "depth_cm": 13.0, "road": "Bhavbhuti Marg"},

        # --- 6. Tagore Road (2 potholes) ---
        {"id": "ph_tagore_rd_1", "name": "Tagore Road School Zone Crater", "lat": 28.6245, "lon": 77.2208, "severity": "MODERATE", "depth_cm": 11.5, "road": "Tagore Road"},
        {"id": "ph_tagore_rd_2", "name": "Tagore Road / Rouse Ave Connector Rut", "lat": 28.6252, "lon": 77.2215, "severity": "SEVERE", "depth_cm": 12.0, "road": "Tagore Road"},

        # --- 7. Kasturba Gandhi (KG) Marg (2 potholes) ---
        {"id": "ph_kg_marg_1", "name": "KG Marg / Tolstoy Marg Intersection Hole", "lat": 28.6268, "lon": 77.2248, "severity": "MODERATE", "depth_cm": 10.0, "road": "KG Marg"},
        {"id": "ph_kg_marg_2", "name": "KG Marg British Council Approach Dip", "lat": 28.6235, "lon": 77.2260, "severity": "MODERATE", "depth_cm": 11.5, "road": "KG Marg"},

        # --- 8. Mandi House Circle & Sikandra Road (2 potholes) ---
        {"id": "ph_mandi_house_1", "name": "Mandi House Circle NSD Pit", "lat": 28.6258, "lon": 77.2342, "severity": "SEVERE", "depth_cm": 12.5, "road": "Mandi House Circle"},
        {"id": "ph_mandi_house_2", "name": "Mandi House Metro Exit Surface Rut", "lat": 28.6250, "lon": 77.2335, "severity": "MODERATE", "depth_cm": 10.0, "road": "Mandi House Circle"},

        # --- 9. Tilak Bridge & BSZ Marg (ITO Corridor) (4 potholes) ---
        {"id": "ph_tilak_bridge_1", "name": "Tilak Bridge Underpass Pit", "lat": 28.6242, "lon": 77.2378, "severity": "SEVERE", "depth_cm": 16.0, "road": "BSZ Marg"},
        {"id": "ph_tilak_bridge_2", "name": "Tilak Bridge Track Support Drainage Crater", "lat": 28.6238, "lon": 77.2385, "severity": "SEVERE", "depth_cm": 17.5, "road": "BSZ Marg"},
        {"id": "ph_ito_junction_1", "name": "ITO Ring Road Shoulder Crater", "lat": 28.6288, "lon": 77.2408, "severity": "SEVERE", "depth_cm": 14.5, "road": "Vikas Marg / ITO"},
        {"id": "ph_ito_junction_2", "name": "ITO Police HQ Pedestrian Crossing Rut", "lat": 28.6282, "lon": 77.2415, "severity": "SEVERE", "depth_cm": 13.0, "road": "BSZ Marg"},

        # --- 10. Asaf Ali Road & Delhi Gate (4 potholes) ---
        {"id": "ph_asaf_ali_1", "name": "Asaf Ali Road Stock Exchange Pavement Rut", "lat": 28.6408, "lon": 77.2345, "severity": "MODERATE", "depth_cm": 12.0, "road": "Asaf Ali Road"},
        {"id": "ph_asaf_ali_2", "name": "Asaf Ali Road Delite Cinema Ingress Hole", "lat": 28.6398, "lon": 77.2375, "severity": "SEVERE", "depth_cm": 14.0, "road": "Asaf Ali Road"},
        {"id": "ph_delhi_gate_1", "name": "Delhi Gate Ring Road Crossing Hole", "lat": 28.6392, "lon": 77.2402, "severity": "SEVERE", "depth_cm": 13.5, "road": "Delhi Gate"},
        {"id": "ph_delhi_gate_2", "name": "Delhi Gate / LNJP Emergency Gate Depression", "lat": 28.6380, "lon": 77.2410, "severity": "SEVERE", "depth_cm": 15.0, "road": "Jawaharlal Nehru Marg"},

        # --- 11. Panchkuian Road & BKS Marg (4 potholes) ---
        {"id": "ph_panchkuian_1", "name": "Panchkuian Furniture Market Road Dip", "lat": 28.6352, "lon": 77.2078, "severity": "MODERATE", "depth_cm": 11.0, "road": "Panchkuian Road"},
        {"id": "ph_panchkuian_2", "name": "Panchkuian / RK Ashram Metro Trench", "lat": 28.6360, "lon": 77.2025, "severity": "SEVERE", "depth_cm": 13.5, "road": "Panchkuian Road"},
        {"id": "ph_bks_marg_1", "name": "BKS Marg State Emporia Complex Crater", "lat": 28.6262, "lon": 77.2095, "severity": "MODERATE", "depth_cm": 10.5, "road": "Baba Kharak Singh Marg"},
        {"id": "ph_bks_marg_2", "name": "BKS Marg Hanuman Mandir Approach Rut", "lat": 28.6275, "lon": 77.2120, "severity": "SEVERE", "depth_cm": 12.0, "road": "Baba Kharak Singh Marg"},

        # --- 12. Greater Regional Delhi Arterial Corridors (16 potholes) ---
        {"id": "ph_moolchand_1", "name": "Moolchand Underpass Surface Rut", "lat": 28.5662, "lon": 77.2348, "severity": "SEVERE", "depth_cm": 17.0, "road": "Ring Road South"},
        {"id": "ph_ashram_1", "name": "Ashram Chowk Service Lane Hole", "lat": 28.5712, "lon": 77.2575, "severity": "SEVERE", "depth_cm": 15.5, "road": "Mathura Road"},
        {"id": "ph_pul_prahladpur_1", "name": "Pul Prahladpur Sag Trench", "lat": 28.5122, "lon": 77.2918, "severity": "SEVERE", "depth_cm": 22.0, "road": "MB Road"},
        {"id": "ph_zakhira_1", "name": "Zakhira Underpass Broken Bitumen", "lat": 28.6652, "lon": 77.1548, "severity": "SEVERE", "depth_cm": 19.0, "road": "Rohtak Road"},
        {"id": "ph_kashmere_gate_1", "name": "Kashmere Gate Low Dip Crater", "lat": 28.6642, "lon": 77.2338, "severity": "MODERATE", "depth_cm": 11.0, "road": "Ring Road North"},
        {"id": "ph_dhaula_kuan_1", "name": "Dhaula Kuan Subway Depression", "lat": 28.5902, "lon": 77.1582, "severity": "MODERATE", "depth_cm": 10.5, "road": "NH-48"},
        {"id": "ph_aiims_subway_1", "name": "AIIMS Subway Approach Rut", "lat": 28.5668, "lon": 77.2112, "severity": "MODERATE", "depth_cm": 9.0, "road": "Aurobindo Marg"},
        {"id": "ph_patel_nagar_1", "name": "Patel Nagar Shadipur Trench", "lat": 28.6508, "lon": 77.1575, "severity": "MODERATE", "depth_cm": 10.0, "road": "Main Patel Road"},
        {"id": "ph_laxmi_nagar_1", "name": "Laxmi Nagar Vikas Marg Gully", "lat": 28.6302, "lon": 77.2768, "severity": "SEVERE", "depth_cm": 14.0, "road": "Vikas Marg East"},
        {"id": "ph_anand_vihar_1", "name": "Anand Vihar ISBT Entry Rut", "lat": 28.6472, "lon": 77.3150, "severity": "MODERATE", "depth_cm": 9.0, "road": "Gazipur Road"},
        {"id": "ph_sarai_kale_khan_1", "name": "Sarai Kale Khan Ring Road Dip", "lat": 28.5912, "lon": 77.2558, "severity": "MODERATE", "depth_cm": 11.5, "road": "Ring Road East"},
        {"id": "ph_delhi_cantt_1", "name": "Delhi Cantt Flyover Ramp Hole", "lat": 28.5972, "lon": 77.1288, "severity": "MODERATE", "depth_cm": 8.0, "road": "Jail Road"},
        {"id": "ph_janakpuri_1", "name": "Janakpuri Outer Ring Crack", "lat": 28.6292, "lon": 77.0808, "severity": "MODERATE", "depth_cm": 7.5, "road": "Najafgarh Road"},
        {"id": "ph_azadpur_1", "name": "Azadpur Mandi Entry Crater", "lat": 28.7088, "lon": 77.1755, "severity": "SEVERE", "depth_cm": 16.5, "road": "GT Karnal Road"},
        {"id": "ph_pragati_maidan_1", "name": "Pragati Maidan Tunnel Dip Rut", "lat": 28.6212, "lon": 77.2462, "severity": "SEVERE", "depth_cm": 15.0, "road": "Bhairon Marg"},
        {"id": "ph_gtb_shahdara_1", "name": "GTB Hospital Approach Trench", "lat": 28.6838, "lon": 77.3118, "severity": "SEVERE", "depth_cm": 13.5, "road": "Tahirpur Road"},
    ]

    # Resolve all deferred and cross-corridor edges
    resolve_edges()

    payload = {
        "nodes": nodes,
        "edges": edges_list,
        "potholes": potholes,
        "center": {
            "lat": 28.6139,
            "lon": 77.2090
        },
        "zoom": 12,
        "coverage_radius_km": 30.0,
        "location": "Greater Delhi NCR (30km Dense Street & Emergency Corridor Network)"
    }

    out_file = Path(__file__).resolve().parent / "cache" / "network.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Generated {len(nodes)} nodes, {len(edges_list)} street segments, {len(potholes)} potholes -> {out_file}")

    # Synchronize with frontend/src/lib/networkData.ts
    frontend_ts_file = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "lib" / "networkData.ts"
    if frontend_ts_file.parent.exists():
        nodes_ts = json.dumps(nodes, indent=2)
        edges_ts = json.dumps(edges_list, indent=2)
        potholes_ts = json.dumps(potholes, indent=2)

        ts_text = (
            'import type { NodeDepth, NetworkEdge, SimulateResponse, RouteResponse, PathCoord, PotholeHazard, FloodSummary, AlternateRouteInfo } from "./api";\n\n'
            'export interface CatchmentNodeInfo {\n'
            '  lat: number;\n'
            '  lon: number;\n'
            '  elevation: number;\n'
            '  catch_area: number;\n'
            '  name: string;\n'
            '  role?: "sag" | "hospital" | "railway" | "junction";\n'
            '}\n\n'
            f'export const CATCHMENT_NODES: Record<string, CatchmentNodeInfo> = {nodes_ts};\n\n'
            f'export const INITIAL_EDGES: NetworkEdge[] = {edges_ts};\n\n'
            f'export const POTHOLE_HAZARDS: PotholeHazard[] = {potholes_ts};\n\n'
            'export interface EmergencyDestination {\n'
            '  id: string;\n'
            '  name: string;\n'
            '  category: "Trauma & Apex" | "Super Speciality" | "Regional Hospital" | "Transit Terminal";\n'
            '  badge: string;\n'
            '  area: string;\n'
            '  icon: string;\n'
            '}\n\n'
            'export const TOP_15_DESTINATIONS: EmergencyDestination[] = [\n'
            '  { id: "aiims_delhi", name: "AIIMS New Delhi (Apex Trauma Centre)", category: "Trauma & Apex", badge: "Apex Trauma Centre", area: "South Delhi / Ring Road", icon: "🏥" },\n'
            '  { id: "safdarjung_hospital", name: "Safdarjung Hospital Emergency", category: "Trauma & Apex", badge: "Govt Trauma Care", area: "Ring Road South", icon: "🏥" },\n'
            '  { id: "rml_hospital", name: "Dr. Ram Manohar Lohia (RML) Hospital", category: "Trauma & Apex", badge: "Central Emergency", area: "CP / Sansad Marg", icon: "🏥" },\n'
            '  { id: "lnjp_hospital", name: "LNJP Hospital (Lok Nayak)", category: "Regional Hospital", badge: "Central Govt Hospital", area: "Delhi Gate / BSZ Marg", icon: "🏥" },\n'
            '  { id: "gb_pant_hospital", name: "GB Pant Hospital Complex", category: "Super Speciality", badge: "Cardiac & Neuro Hub", area: "JLN Marg / Delhi Gate", icon: "🏥" },\n'
            '  { id: "ganga_ram_hospital", name: "Sir Ganga Ram Hospital", category: "Super Speciality", badge: "Multi-Speciality Centre", area: "Karol Bagh / Rajendra Place", icon: "🏥" },\n'
            '  { id: "lady_hardinge", name: "Lady Hardinge Medical College & Hospital", category: "Regional Hospital", badge: "Women & Child Care", area: "Connaught Place West", icon: "🏥" },\n'
            '  { id: "blkapoor_hospital", name: "BLK-Max Super Speciality Hospital", category: "Super Speciality", badge: "Tertiary Care Hub", area: "Pusa Road / Karol Bagh", icon: "🏥" },\n'
            '  { id: "max_hospital_saket", name: "Max Super Speciality Hospital Saket", category: "Super Speciality", badge: "Max Healthcare Apex", area: "Saket / South Delhi", icon: "🏥" },\n'
            '  { id: "moolchand_hospital", name: "Moolchand Medcity Hospital", category: "Super Speciality", badge: "Emergency Medcity", area: "Ring Road / Lajpat Nagar", icon: "🏥" },\n'
            '  { id: "fortis_escorts_okhla", name: "Fortis Escorts Heart Institute Okhla", category: "Super Speciality", badge: "Cardiac Emergency", area: "Okhla / Mathura Road", icon: "🏥" },\n'
            '  { id: "holy_family_hospital", name: "Holy Family Hospital Okhla", category: "Regional Hospital", badge: "Multi-Speciality Care", area: "Jamia / Okhla", icon: "🏥" },\n'
            '  { id: "apollo_hospital_sarita_vihar", name: "Indraprastha Apollo Hospital", category: "Super Speciality", badge: "Apollo Healthcare Hub", area: "Sarita Vihar / Mathura Rd", icon: "🏥" },\n'
            '  { id: "gtb_hospital_shahdara", name: "GTB Hospital & UCMS Shahdara", category: "Trauma & Apex", badge: "East Delhi Apex Trauma", area: "Shahdara / Dilshad Garden", icon: "🏥" },\n'
            '  { id: "max_hospital_patparganj", name: "Max Super Speciality Patparganj", category: "Super Speciality", badge: "Trans-Yamuna Healthcare", area: "Patparganj / IP Extension", icon: "🏥" },\n'
            '];\n\n'
            'export const INITIAL_NODES: NodeDepth[] = Object.entries(CATCHMENT_NODES).map(([id, n]) => ({\n'
            '  node_id: id,\n'
            '  id: id,\n'
            '  name: n.name,\n'
            '  lat: n.lat,\n'
            '  lon: n.lon,\n'
            '  lng: n.lon,\n'
            '  depth_cm: 0,\n'
            '  depth: 0,\n'
            '  risk_level: "SAFE" as const,\n'
            '  risk: "SAFE" as const,\n'
            '  role: n.role,\n'
            '}));\n\n'
            '// Global in-memory fast caches\n'
            'const _routeMemoryCache = new Map<string, RouteResponse>();\n'
            'const _simulateMemoryCache = new Map<string, SimulateResponse>();\n\n'
            'export function clearLocalCaches(): void {\n'
            '  _routeMemoryCache.clear();\n'
            '  _simulateMemoryCache.clear();\n'
            '}\n\n'
            'export function simulateLocal(\n'
            '  rainMmHr: number,\n'
            '  minutes: number = 30,\n'
            '  blockedNodes: string[] = []\n'
            '): SimulateResponse {\n'
            '  const simKey = `${rainMmHr}_${minutes}_${blockedNodes.slice().sort().join(",")}`;\n'
            '  if (_simulateMemoryCache.has(simKey)) {\n'
            '    return _simulateMemoryCache.get(simKey)!;\n'
            '  }\n\n'
            '  const depths: Record<string, number> = {};\n'
            '  const nodesList: NodeDepth[] = [];\n'
            '  const blockedSet = new Set(blockedNodes);\n\n'
            '  const rainIntensity = Math.max(0, rainMmHr);\n'
            '  const durationSec = Math.max(1, minutes * 60);\n\n'
            '  const riskBreakdown = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, SAFE: 0 };\n'
            '  let floodedCount = 0;\n'
            '  let totalFloodedDepth = 0;\n'
            '  let totalDepth = 0;\n\n'
            '  for (const [id, node] of Object.entries(CATCHMENT_NODES)) {\n'
            '    const area = node.catch_area || 3000;\n'
            '    const inflowRate = (rainIntensity * area) / 3600000; // m3/s\n'
            '    \n'
            '    let maxDrainRate = 0.04;\n'
            '    if (node.role === "sag") {\n'
            '      maxDrainRate = 0.015;\n'
            '    } else if (node.role === "hospital") {\n'
            '      maxDrainRate = 0.07;\n'
            '    }\n\n'
            '    if (blockedSet.has(id)) {\n'
            '      maxDrainRate *= 0.1;\n'
            '    }\n\n'
            '    const netRate = Math.max(0, inflowRate - maxDrainRate);\n'
            '    const accumVolumeM3 = netRate * durationSec;\n'
            '    \n'
            '    const pondingAreaM2 = node.role === "sag" ? 120.0 : 350.0;\n'
            '    let depthCm = (accumVolumeM3 / pondingAreaM2) * 100.0;\n'
            '    \n'
            '    const elevDiff = 220.0 - node.elevation;\n'
            '    if (elevDiff > 0) {\n'
            '      depthCm += elevDiff * 0.8 * (rainIntensity / 50.0);\n'
            '    }\n\n'
            '    depthCm = Math.max(0, Math.min(depthCm, 250.0));\n'
            '    const roundedDepth = Number(depthCm.toFixed(1));\n'
            '    depths[id] = roundedDepth;\n'
            '    totalDepth += roundedDepth;\n\n'
            '    let riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SAFE" = "SAFE";\n'
            '    if (roundedDepth > 40.0) {\n'
            '      riskLevel = "CRITICAL";\n'
            '      riskBreakdown.CRITICAL++;\n'
            '    } else if (roundedDepth > 25.0) {\n'
            '      riskLevel = "HIGH";\n'
            '      riskBreakdown.HIGH++;\n'
            '    } else if (roundedDepth > 15.0) {\n'
            '      riskLevel = "MEDIUM";\n'
            '      riskBreakdown.MEDIUM++;\n'
            '    } else if (roundedDepth > 5.0) {\n'
            '      riskLevel = "LOW";\n'
            '      riskBreakdown.LOW++;\n'
            '    } else {\n'
            '      riskBreakdown.SAFE++;\n'
            '    }\n\n'
            '    if (roundedDepth > 0) {\n'
            '      floodedCount++;\n'
            '      totalFloodedDepth += roundedDepth;\n'
            '    }\n\n'
            '    nodesList.push({\n'
            '      node_id: id,\n'
            '      id: id,\n'
            '      name: node.name,\n'
            '      lat: node.lat,\n'
            '      lon: node.lon,\n'
            '      lng: node.lon,\n'
            '      depth_cm: roundedDepth,\n'
            '      depth: roundedDepth,\n'
            '      risk_level: riskLevel,\n'
            '      risk: riskLevel,\n'
            '      blocked: blockedSet.has(id),\n'
            '      role: node.role,\n'
            '    });\n'
            '  }\n\n'
            '  const totalNodes = Object.keys(CATCHMENT_NODES).length;\n'
            '  const summary: FloodSummary = {\n'
            '    total_nodes: totalNodes,\n'
            '    flooded_nodes: floodedCount,\n'
            '    max_depth_cm: Math.max(...Object.values(depths)),\n'
            '    avg_depth_cm: Number((totalDepth / Math.max(1, totalNodes)).toFixed(1)),\n'
            '    avg_flooded_depth_cm: Number((totalFloodedDepth / Math.max(1, floodedCount)).toFixed(1)),\n'
            '    risk_breakdown: riskBreakdown,\n'
            '  };\n\n'
            '  const res: SimulateResponse = {\n'
            '    depths,\n'
            '    nodes: nodesList,\n'
            '    summary,\n'
            '    rain_mm: rainMmHr,\n'
            '    minutes,\n'
            '  };\n\n'
            '  if (_simulateMemoryCache.size < 500) {\n'
            '    _simulateMemoryCache.set(simKey, res);\n'
            '  }\n'
            '  return res;\n'
            '}\n\n'
            'export function findRouteLocal(\n'
            '  source: string,\n'
            '  target: string,\n'
            '  rainMmHr: number,\n'
            '  thresholdCm: number = 15.0,\n'
            '  minutes: number = 30,\n'
            '  blockedNodes: string[] = [],\n'
            '  currentDepths?: Record<string, number>\n'
            '): RouteResponse {\n'
            '  const routeKey = `${source}_${target}_${rainMmHr}_${thresholdCm}_${minutes}_${blockedNodes.slice().sort().join(",")}`;\n'
            '  if (!currentDepths && _routeMemoryCache.has(routeKey)) {\n'
            '    return _routeMemoryCache.get(routeKey)!;\n'
            '  }\n\n'
            '  const depths = currentDepths || simulateLocal(rainMmHr, minutes, blockedNodes).depths;\n'
            '  const blockedSet = new Set(blockedNodes);\n\n'
            '  const adj: Record<string, { node: string; dist: number }[]> = {};\n'
            '  for (const id of Object.keys(CATCHMENT_NODES)) {\n'
            '    adj[id] = [];\n'
            '  }\n'
            '  for (const edge of INITIAL_EDGES) {\n'
            '    const u = edge.from || edge.from_id;\n'
            '    const v = edge.to || edge.to_id;\n'
            '    if (u && v && adj[u] && adj[v]) {\n'
            '      const d = edge.length_m || edge.length || 200;\n'
            '      adj[u].push({ node: v, dist: d });\n'
            '      adj[v].push({ node: u, dist: d });\n'
            '    }\n'
            '  }\n\n'
            '  // 1. Baseline shortest path\n'
            '  const normalDist: Record<string, number> = {};\n'
            '  const normalPrev: Record<string, string | null> = {};\n'
            '  const normalQ = new Set(Object.keys(CATCHMENT_NODES));\n'
            '  for (const id of Object.keys(CATCHMENT_NODES)) {\n'
            '    normalDist[id] = Infinity;\n'
            '    normalPrev[id] = null;\n'
            '  }\n'
            '  if (normalDist[source] !== undefined) normalDist[source] = 0;\n\n'
            '  while (normalQ.size > 0) {\n'
            '    let u: string | null = null;\n'
            '    let minD = Infinity;\n'
            '    for (const node of normalQ) {\n'
            '      if (normalDist[node] < minD) {\n'
            '        minD = normalDist[node];\n'
            '        u = node;\n'
            '      }\n'
            '    }\n'
            '    if (!u || minD === Infinity) break;\n'
            '    normalQ.delete(u);\n'
            '    if (u === target) break;\n\n'
            '    for (const neighbor of adj[u] || []) {\n'
            '      if (normalQ.has(neighbor.node)) {\n'
            '        const alt = normalDist[u] + neighbor.dist;\n'
            '        if (alt < normalDist[neighbor.node]) {\n'
            '          normalDist[neighbor.node] = alt;\n'
            '          normalPrev[neighbor.node] = u;\n'
            '        }\n'
            '      }\n'
            '    }\n'
            '  }\n\n'
            '  const normalPath: string[] = [];\n'
            '  let currN: string | null = target;\n'
            '  if (normalDist[target] !== Infinity) {\n'
            '    while (currN) {\n'
            '      normalPath.unshift(currN);\n'
            '      currN = normalPrev[currN];\n'
            '    }\n'
            '  }\n'
            '  const normalPathCoords: PathCoord[] = normalPath.map(id => ({\n'
            '    node_id: id,\n'
            '    name: CATCHMENT_NODES[id]?.name || id,\n'
            '    lat: CATCHMENT_NODES[id]?.lat || 0,\n'
            '    lon: CATCHMENT_NODES[id]?.lon || 0,\n'
            '  }));\n'
            '  const normalMaxDepth = normalPath.length > 0 ? Math.max(...normalPath.map(id => depths[id] || 0)) : 0;\n'
            '  const normalDistanceM = normalDist[target] !== Infinity ? Math.round(normalDist[target]) : 0;\n\n'
            '  // Safety checks\n'
            '  const srcDepth = depths[source] || 0;\n'
            '  const tgtDepth = depths[target] || 0;\n'
            '  if (srcDepth > thresholdCm || blockedSet.has(source)) {\n'
            '    const res: RouteResponse = {\n'
            '      path: [],\n'
            '      path_coords: [],\n'
            '      normal_path: normalPath,\n'
            '      normal_path_coords: normalPathCoords,\n'
            '      distance_m: 0,\n'
            '      normal_distance_m: normalDistanceM,\n'
            '      safe_distance_m: 0,\n'
            '      normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),\n'
            '      safe_max_depth_cm: 0,\n'
            '      is_rerouted: false,\n'
            '      blocked_nodes: blockedNodes,\n'
            '      blocked_count: blockedNodes.length,\n'
            '      eta_normal_sec: Math.round(normalDistanceM / (30000 / 3600)),\n'
            '      eta_safe_sec: 0,\n'
            '      eta_sec: 0,\n'
            '      eta_saved_sec: 0,\n'
            '      reachable: false,\n'
            '      reason: "ORIGIN_UNSAFE",\n'
            '      origin_depth_cm: Number(srcDepth.toFixed(1)),\n'
            '      destination_depth_cm: Number(tgtDepth.toFixed(1)),\n'
            '      threshold_cm: thresholdCm,\n'
            '      message: `Origin \'${CATCHMENT_NODES[source]?.name || source}\' is submerged (${srcDepth.toFixed(1)} cm > ${thresholdCm} cm threshold). Departure unsafe.`,\n'
            '    };\n'
            '    if (_routeMemoryCache.size < 2000) _routeMemoryCache.set(routeKey, res);\n'
            '    return res;\n'
            '  }\n\n'
            '  if (tgtDepth > thresholdCm || blockedSet.has(target)) {\n'
            '    const res: RouteResponse = {\n'
            '      path: [],\n'
            '      path_coords: [],\n'
            '      normal_path: normalPath,\n'
            '      normal_path_coords: normalPathCoords,\n'
            '      distance_m: 0,\n'
            '      normal_distance_m: normalDistanceM,\n'
            '      safe_distance_m: 0,\n'
            '      normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),\n'
            '      safe_max_depth_cm: 0,\n'
            '      is_rerouted: false,\n'
            '      blocked_nodes: blockedNodes,\n'
            '      blocked_count: blockedNodes.length,\n'
            '      eta_normal_sec: Math.round(normalDistanceM / (30000 / 3600)),\n'
            '      eta_safe_sec: 0,\n'
            '      eta_sec: 0,\n'
            '      eta_saved_sec: 0,\n'
            '      reachable: false,\n'
            '      reason: "DESTINATION_UNSAFE",\n'
            '      origin_depth_cm: Number(srcDepth.toFixed(1)),\n'
            '      destination_depth_cm: Number(tgtDepth.toFixed(1)),\n'
            '      threshold_cm: thresholdCm,\n'
            '      message: `Destination \'${CATCHMENT_NODES[target]?.name || target}\' is submerged (${tgtDepth.toFixed(1)} cm > ${thresholdCm} cm threshold). Inaccessible.`,\n'
            '    };\n'
            '    if (_routeMemoryCache.size < 2000) _routeMemoryCache.set(routeKey, res);\n'
            '    return res;\n'
            '  }\n\n'
            '  // 2. Safe Dijkstra\n'
            '  const dist: Record<string, number> = {};\n'
            '  const prev: Record<string, string | null> = {};\n'
            '  const Q = new Set(Object.keys(CATCHMENT_NODES));\n'
            '  for (const id of Object.keys(CATCHMENT_NODES)) {\n'
            '    dist[id] = Infinity;\n'
            '    prev[id] = null;\n'
            '  }\n'
            '  dist[source] = 0;\n\n'
            '  while (Q.size > 0) {\n'
            '    let u: string | null = null;\n'
            '    let minD = Infinity;\n'
            '    for (const node of Q) {\n'
            '      if (dist[node] < minD) {\n'
            '        minD = dist[node];\n'
            '        u = node;\n'
            '      }\n'
            '    }\n'
            '    if (!u || minD === Infinity) break;\n'
            '    Q.delete(u);\n'
            '    if (u === target) break;\n\n'
            '    for (const neighbor of adj[u] || []) {\n'
            '      const v = neighbor.node;\n'
            '      if (Q.has(v)) {\n'
            '        const vDepth = depths[v] || 0;\n'
            '        if (vDepth > thresholdCm || blockedSet.has(v)) {\n'
            '          continue;\n'
            '        }\n'
            '        const alt = dist[u] + neighbor.dist;\n'
            '        if (alt < dist[v]) {\n'
            '          dist[v] = alt;\n'
            '          prev[v] = u;\n'
            '        }\n'
            '      }\n'
            '    }\n'
            '  }\n\n'
            '  if (dist[target] === Infinity) {\n'
            '    const res: RouteResponse = {\n'
            '      path: [],\n'
            '      path_coords: [],\n'
            '      normal_path: normalPath,\n'
            '      normal_path_coords: normalPathCoords,\n'
            '      distance_m: 0,\n'
            '      normal_distance_m: normalDistanceM,\n'
            '      safe_distance_m: 0,\n'
            '      normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),\n'
            '      safe_max_depth_cm: 0,\n'
            '      is_rerouted: false,\n'
            '      blocked_nodes: blockedNodes,\n'
            '      blocked_count: blockedNodes.length,\n'
            '      eta_normal_sec: Math.round(normalDistanceM / (30000 / 3600)),\n'
            '      eta_safe_sec: 0,\n'
            '      eta_sec: 0,\n'
            '      eta_saved_sec: 0,\n'
            '      reachable: false,\n'
            '      reason: "NO_SAFE_PATH",\n'
            '      origin_depth_cm: Number(srcDepth.toFixed(1)),\n'
            '      destination_depth_cm: Number(tgtDepth.toFixed(1)),\n'
            '      threshold_cm: thresholdCm,\n'
            '      message: `No safe route available between \'${CATCHMENT_NODES[source]?.name || source}\' and \'${CATCHMENT_NODES[target]?.name || target}\' with water depth <= ${thresholdCm} cm.`,\n'
            '    };\n'
            '    if (_routeMemoryCache.size < 2000) _routeMemoryCache.set(routeKey, res);\n'
            '    return res;\n'
            '  }\n\n'
            '  const path: string[] = [];\n'
            '  let curr: string | null = target;\n'
            '  while (curr) {\n'
            '    path.unshift(curr);\n'
            '    curr = prev[curr];\n'
            '  }\n\n'
            '  const safeDist = dist[target];\n'
            '  const speedMps = 30000 / 3600;\n'
            '  const etaNormal = (normalDistanceM / speedMps);\n'
            '  const etaSafe = safeDist / speedMps;\n'
            '  const detourDelay = Math.max(0, etaSafe - etaNormal);\n'
            '  const detourExtra = Math.max(0, safeDist - normalDistanceM);\n'
            '  const safeMaxDepth = path.length > 0 ? Math.max(...path.map(id => depths[id] || 0)) : 0;\n'
            '  const isRerouted = (path.join(",") !== normalPath.join(",")) && (normalMaxDepth > thresholdCm);\n\n'
            '  const alternateRoutes: AlternateRouteInfo[] = [];\n'
            '  if (normalPath.length > 1 && (normalPath.join(",") !== path.join(",") || normalMaxDepth > 0)) {\n'
            '    const normFlooded = normalPath.filter(id => (depths[id] || 0) > thresholdCm);\n'
            '    let reason = "Direct shortest corridor clear of water.";\n'
            '    let status = "PASSABLE_CLEAR";\n'
            '    if (normalMaxDepth > 30) {\n'
            '      status = "INUNDATED_CRITICAL";\n'
            '      reason = `AI Rejected: Critical submergence (${normalMaxDepth.toFixed(1)} cm water). Severe risk of ambulance stalling.`;\n'
            '    } else if (normalMaxDepth > thresholdCm) {\n'
            '      status = "SUBMERGED_UNSAFE";\n'
            '      reason = `AI Rejected: Water depth (${normalMaxDepth.toFixed(1)} cm) exceeds ${thresholdCm} cm clearance limit.`;\n'
            '    } else if (normalMaxDepth > 5) {\n'
            '      status = "HIGH_WATER_RISK";\n'
            '      reason = `Notice: Moderate water (${normalMaxDepth.toFixed(1)} cm). Passable with caution.`;\n'
            '    }\n\n'
            '    alternateRoutes.push({\n'
            '      id: "alt_direct",\n'
            '      name: "Direct Shortest Corridor (Unconstrained)",\n'
            '      path: normalPath,\n'
            '      path_coords: normalPathCoords,\n'
            '      distance_m: normalDistanceM,\n'
            '      max_depth_cm: Number(normalMaxDepth.toFixed(1)),\n'
            '      avg_depth_cm: Number((normalPath.reduce((acc, id) => acc + (depths[id] || 0), 0) / normalPath.length).toFixed(1)),\n'
            '      flooded_nodes_count: normFlooded.length,\n'
            '      flooded_nodes: normFlooded,\n'
            '      status: status,\n'
            '      is_safe: normalMaxDepth <= thresholdCm,\n'
            '      reason_rejected: reason,\n'
            '    });\n'
            '  }\n\n'
            '  const pathCoords: PathCoord[] = path.map(id => ({\n'
            '    node_id: id,\n'
            '    name: CATCHMENT_NODES[id]?.name || id,\n'
            '    lat: CATCHMENT_NODES[id]?.lat || 0,\n'
            '    lon: CATCHMENT_NODES[id]?.lon || 0,\n'
            '  }));\n\n'
            '  const res: RouteResponse = {\n'
            '    path,\n'
            '    path_coords: pathCoords,\n'
            '    normal_path: normalPath,\n'
            '    normal_path_coords: normalPathCoords,\n'
            '    distance_m: Math.round(safeDist),\n'
            '    normal_distance_m: normalDistanceM,\n'
            '    safe_distance_m: Math.round(safeDist),\n'
            '    normal_max_depth_cm: Number(normalMaxDepth.toFixed(1)),\n'
            '    safe_max_depth_cm: Number(safeMaxDepth.toFixed(1)),\n'
            '    is_rerouted: isRerouted,\n'
            '    blocked_nodes: blockedNodes,\n'
            '    blocked_count: blockedNodes.length,\n'
            '    eta_normal_sec: Math.round(etaNormal),\n'
            '    eta_safe_sec: Math.round(etaSafe),\n'
            '    eta_sec: Math.round(etaSafe),\n'
            '    eta_saved_sec: Math.round(detourDelay),\n'
            '    detour_delay_sec: Math.round(detourDelay),\n'
            '    detour_extra_m: Math.round(detourExtra),\n'
            '    detour_m: Math.round(detourExtra),\n'
            '    avoided_segments: blockedNodes.length,\n'
            '    alternate_routes: alternateRoutes,\n'
            '    reachable: true,\n'
            '    reason: "ROUTE_FOUND",\n'
            '    origin_depth_cm: Number(srcDepth.toFixed(1)),\n'
            '    destination_depth_cm: Number(tgtDepth.toFixed(1)),\n'
            '    threshold_cm: thresholdCm,\n'
            '    message: `Safe route computed (${Math.round(safeDist)}m) along street centerline avoiding inundated corridors.`,\n'
            '  };\n\n'
            '  if (_routeMemoryCache.size < 2000) {\n'
            '    _routeMemoryCache.set(routeKey, res);\n'
            '  }\n'
            '  return res;\n'
            '}\n\n'
            'export function preWarmAllDestinationRoutes(\n'
            '  source: string,\n'
            '  rainMmHr: number,\n'
            '  thresholdCm: number = 15.0,\n'
            '  minutes: number = 30,\n'
            '  blockedNodes: string[] = []\n'
            '): void {\n'
            '  const sim = simulateLocal(rainMmHr, minutes, blockedNodes);\n'
            '  for (const dest of TOP_15_DESTINATIONS) {\n'
            '    if (dest.id !== source) {\n'
            '      findRouteLocal(source, dest.id, rainMmHr, thresholdCm, minutes, blockedNodes, sim.depths);\n'
            '    }\n'
            '  }\n'
            '}\n'
        )

        with open(frontend_ts_file, "w", encoding="utf-8") as f:
            f.write(ts_text)
        print(f"Synced TypeScript network data -> {frontend_ts_file}")

if __name__ == "__main__":
    build_dense_network()



