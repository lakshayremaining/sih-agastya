/**
 * Agastya — API Client
 * Communicates with the FastAPI backend for flood simulation,
 * routing, choke analysis, and live rain data.
 */

/**
 * Centralized API base URL resolver.
 * - In Production: uses VITE_API_BASE (normalized, trailing slashes removed).
 *   Never defaults to localhost in production.
 * - In Development: defaults to 'http://localhost:8000' only when VITE_API_BASE is unset.
 */
export function getApiBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (envBase) {
    return envBase.replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:8000';
  }
  return '';
}

export const API_BASE = getApiBaseUrl();

// ─── Types ────────────────────────────────────────────────

export interface NodeDepth {
  node_id: string;
  id?: string;
  name: string;
  lat: number;
  lon: number;
  lng?: number;
  depth_cm: number;
  depth?: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  risk?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  blocked?: boolean;
  role?: 'sag' | 'hospital' | 'railway' | 'junction';
}

export interface FloodSummary {
  total_nodes: number;
  flooded_nodes: number;
  max_depth_cm: number;
  avg_depth_cm: number;
  avg_flooded_depth_cm: number;
  risk_breakdown: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    SAFE: number;
  };
}

export interface SimulateResponse {
  depths: Record<string, number>;
  nodes: NodeDepth[];
  summary: FloodSummary;
  rain_mm: number;
  minutes: number;
}

export interface PathCoord {
  node_id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface AlternateRouteInfo {
  id: string;
  name: string;
  path: string[];
  path_coords?: PathCoord[];
  distance_m: number;
  max_depth_cm: number;
  avg_depth_cm: number;
  flooded_nodes_count: number;
  flooded_nodes?: string[];
  status: string;
  is_safe: boolean;
  reason_rejected: string;
}

export interface RouteResponse {
  path: string[];
  path_nodes?: string[];
  path_coords: PathCoord[];
  normal_path?: string[];
  normal_path_coords?: PathCoord[];
  distance_m: number;
  normal_distance_m?: number;
  safe_distance_m?: number;
  normal_max_depth_cm?: number;
  safe_max_depth_cm?: number;
  is_rerouted?: boolean;
  blocked_nodes: string[];
  blocked_count: number;
  eta_normal_sec: number;
  eta_safe_sec: number;
  eta_saved_sec: number;
  detour_delay_sec?: number;
  detour_extra_m?: number;
  detour_m?: number;
  eta_sec?: number;
  avoided_segments?: number;
  alternate_routes?: AlternateRouteInfo[];
  reachable: boolean;
  reason?: string;
  origin_depth_cm?: number;
  destination_depth_cm?: number;
  threshold_cm?: number;
  message: string;
}


export interface ChokeNeighbour {
  node_id: string;
  name: string;
  depth_before_cm: number;
  depth_after_cm: number;
  depth_increase_cm: number;
  lat: number;
  lon: number;
}

export interface ChokeResponse {
  choked_node: string;
  choked_name: string;
  flooded_neighbours: ChokeNeighbour[];
  depths_after: Record<string, number>;
  total_depth_increase_cm: number;
}

export interface NetworkNode {
  lat: number;
  lon: number;
  name: string;
  elevation: number;
}

export interface NetworkEdge {
  from?: string;
  to?: string;
  from_id?: string;
  to_id?: string;
  from_name?: string;
  to_name?: string;
  from_lat: number;
  from_lon: number;
  to_lat: number;
  to_lon: number;
  length_m?: number;
  length?: number;
  diameter_m?: number;
  diameter?: number;
  slope?: number;
  status?: string;
  max_capacity_m3s?: number;
}

export interface PotholeHazard {
  id: string;
  name: string;
  lat: number;
  lon: number;
  severity: 'SEVERE' | 'MODERATE' | 'LOW';
  depth_cm: number;
  road: string;
}

export interface NetworkResponse {
  nodes: Record<string, NetworkNode>;
  edges: NetworkEdge[];
  potholes?: PotholeHazard[];
  center: { lat: number; lon: number };
  zoom: number;
  coverage_radius_km?: number;
  location: string;
}

export interface RainHourly {
  time: string;
  precipitation_mm: number;
  rain_mm: number;
  weather_code: number;
}

export interface RainResponse {
  location: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  current_rain_mm: number;
  current_temperature_c: number;
  wind_speed_kmh: number;
  hourly_forecast: RainHourly[];
  source: string;
}

// ─── High-Performance Client LRU Cache & In-Flight Request Deduplication ───

class ClientLRUCache<K, V> {
  private cache = new Map<K, V>();
  private capacity: number;
  constructor(capacity: number = 2000) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

const simulateCache = new ClientLRUCache<string, SimulateResponse>(1000);
const routeCache = new ClientLRUCache<string, RouteResponse>(2000);
const chokeCache = new ClientLRUCache<string, ChokeResponse>(500);
const pysewerSynthCache = new ClientLRUCache<number, PysewerSynthesizeResponse>(100);

let _cachedNetwork: NetworkResponse | null = null;
let _cachedPysewerStatus: PysewerStatusResponse | null = null;
let _cachedLiveRain: { data: RainResponse; time: number } | null = null;

// In-flight promise deduplication to prevent redundant concurrent fetches
const inFlightRequests = new Map<string, Promise<any>>();

function deduplicate<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key) as Promise<T>;
  }
  const promise = fn()
    .finally(() => {
      inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, promise);
  return promise;
}

// ─── API Functions ────────────────────────────────────────

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = API_BASE ? `${API_BASE}${normalizedEndpoint}` : normalizedEndpoint;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export function getSimulateCacheKey(rain_mm: number, minutes: number = 30, blocked_nodes: string[] = []): string {
  const sortedBlocked = [...blocked_nodes].sort().join(',');
  return `${Math.round(rain_mm * 10) / 10}_${minutes}_${sortedBlocked}`;
}

export function getCachedSimulate(rain_mm: number, minutes: number = 30, blocked_nodes: string[] = []): SimulateResponse | undefined {
  return simulateCache.get(getSimulateCacheKey(rain_mm, minutes, blocked_nodes));
}

export async function simulate(
  rain_mm: number,
  minutes: number = 30,
  blocked_nodes: string[] = [],
  signal?: AbortSignal
): Promise<SimulateResponse> {
  const key = getSimulateCacheKey(rain_mm, minutes, blocked_nodes);
  const cached = simulateCache.get(key);
  if (cached) return cached;

  return deduplicate(`sim_${key}`, async () => {
    const res = await fetchApi<SimulateResponse>('/api/simulate', {
      method: 'POST',
      body: JSON.stringify({ rain_mm, minutes, blocked_nodes }),
      signal,
    });
    simulateCache.set(key, res);
    return res;
  });
}

export function getRouteCacheKey(
  source: string,
  target: string,
  rain_mm: number,
  threshold_cm: number = 15,
  minutes: number = 30,
  blocked_nodes: string[] = [],
  depths?: Record<string, number>
): string {
  const sortedBlocked = [...blocked_nodes].sort().join(',');
  const depthHash = depths
    ? Object.entries(depths)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${Math.round(v * 10) / 10}`)
        .sort()
        .join(';')
    : '';
  return `${source}->${target}_${Math.round(rain_mm * 10) / 10}_${threshold_cm}_${minutes}_${sortedBlocked}_${depthHash}`;
}

export function getCachedRoute(
  source: string,
  target: string,
  rain_mm: number,
  threshold_cm: number = 15,
  minutes: number = 30,
  blocked_nodes: string[] = [],
  depths?: Record<string, number>
): RouteResponse | undefined {
  return routeCache.get(getRouteCacheKey(source, target, rain_mm, threshold_cm, minutes, blocked_nodes, depths));
}

export async function findRoute(
  source: string,
  target: string,
  rain_mm: number,
  threshold_cm: number = 15,
  minutes: number = 30,
  blocked_nodes: string[] = [],
  depths?: Record<string, number>,
  signal?: AbortSignal
): Promise<RouteResponse> {
  const key = getRouteCacheKey(source, target, rain_mm, threshold_cm, minutes, blocked_nodes, depths);
  const cached = routeCache.get(key);
  if (cached) return cached;

  return deduplicate(`route_${key}`, async () => {
    const res = await fetchApi<RouteResponse>('/api/route', {
      method: 'POST',
      body: JSON.stringify({ source, target, rain_mm, threshold_cm, minutes, blocked_nodes, depths }),
      signal,
    });
    routeCache.set(key, res);
    return res;
  });
}

export async function chokeNode(
  node_id: string,
  rain_mm: number,
  minutes: number = 30,
  node_ids: string[] = []
): Promise<ChokeResponse> {
  const key = `${node_id}_${[...node_ids].sort().join(',')}_${Math.round(rain_mm * 10) / 10}_${minutes}`;
  const cached = chokeCache.get(key);
  if (cached) return cached;

  return deduplicate(`choke_${key}`, async () => {
    const res = await fetchApi<ChokeResponse>('/api/choke', {
      method: 'POST',
      body: JSON.stringify({ node_id, rain_mm, minutes, node_ids }),
    });
    chokeCache.set(key, res);
    return res;
  });
}

export async function fetchLiveRain(): Promise<RainResponse> {
  const now = Date.now();
  // 3 minute client TTL cache
  if (_cachedLiveRain && now - _cachedLiveRain.time < 180000) {
    return _cachedLiveRain.data;
  }

  return deduplicate('rain_live', async () => {
    const res = await fetchApi<RainResponse>('/api/rain/live');
    _cachedLiveRain = { data: res, time: Date.now() };
    return res;
  });
}

export async function fetchNetwork(): Promise<NetworkResponse> {
  if (_cachedNetwork) return _cachedNetwork;

  try {
    const fromSession = sessionStorage.getItem('agastya_network_cache');
    if (fromSession) {
      _cachedNetwork = JSON.parse(fromSession);
      return _cachedNetwork!;
    }
  } catch {
    // sessionStorage not accessible or quota exceeded
  }

  return deduplicate('network_static', async () => {
    const res = await fetchApi<NetworkResponse>('/api/network');
    _cachedNetwork = res;
    try {
      sessionStorage.setItem('agastya_network_cache', JSON.stringify(res));
    } catch {
      // ignore
    }
    return res;
  });
}

export interface PysewerStatusResponse {
  pysewer_installed: boolean;
  version: string | null;
  mode: string;
  description: string;
  standards: string;
  hydraulic_solver: string;
  minimum_slope: number;
  self_cleansing_velocity_ms: number;
  max_velocity_ms: number;
  manning_roughness_concrete: number;
  catchment: string;
}

export interface PysewerSynthesizeResponse {
  status: string;
  method: string;
  outfall_node: string;
  outfall_elevation_m: number;
  total_nodes: number;
  total_pipes: number;
  total_length_m: number;
  design_rainfall_mm_hr: number;
  compliant_cleansing_count?: number;
  compliance_pct?: number;
  pipes: Array<{
    from_node: string;
    to_node: string;
    from_name?: string;
    to_name?: string;
    length_m: number;
    slope_pct: number;
    design_flow_m3s: number;
    diameter_m: number;
    diameter_mm: number;
    capacity_m3s: number;
    velocity_ms: number;
    meets_cleansing_vel: boolean;
    scouring_risk?: boolean;
  }>;
}

export async function fetchPysewerStatus(): Promise<PysewerStatusResponse> {
  if (_cachedPysewerStatus) return _cachedPysewerStatus;
  return deduplicate('pysewer_status', async () => {
    const res = await fetchApi<PysewerStatusResponse>('/api/pysewer/status');
    _cachedPysewerStatus = res;
    return res;
  });
}

export async function synthesizePysewer(design_rain_mm_hr: number = 35): Promise<PysewerSynthesizeResponse> {
  const rounded = Math.round(design_rain_mm_hr * 10) / 10;
  const cached = pysewerSynthCache.get(rounded);
  if (cached) return cached;

  return deduplicate(`pysewer_synth_${rounded}`, async () => {
    const res = await fetchApi<PysewerSynthesizeResponse>(`/api/pysewer/synthesize?design_rain_mm_hr=${design_rain_mm_hr}`, {
      method: 'POST',
    });
    pysewerSynthCache.set(rounded, res);
    return res;
  });
}

export async function healthCheck(): Promise<{ status: string }> {
  return fetchApi<{ status: string }>('/health');
}

