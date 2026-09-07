/**
 * Agastya — Sidebar Component
 * Premium glassmorphic sidebar with brand, rainfall intensity slider,
 * storm duration accumulation slider, multi-node choke simulation controls,
 * dashboard KPIs, charts, and legend.
 */

import { useMemo, useState, useEffect } from 'react';
import type { FloodSummary, RainResponse } from '../lib/api';
import { TOP_15_DESTINATIONS } from '../lib/networkData';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StatCard from './StatCard';
import RainSlider from './RainSlider';

interface SidebarProps {
  rainMm: number;
  onRainChange: (value: number) => void;
  minutes: number;
  onMinutesChange: (value: number) => void;
  summary: FloodSummary | null;
  rainData: RainResponse | null;
  chokeMode: boolean;
  onChokeModeToggle: () => void;
  blockedNodes: string[];
  onClearBlockedNodes: () => void;
  onUnblockNode?: (id: string) => void;
  showRoute: boolean;
  onRouteToggle: () => void;
  routeSource: string;
  routeTarget: string;
  onRouteSourceChange: (v: string) => void;
  onRouteTargetChange: (v: string) => void;
  routeResult?: import('../lib/api').RouteResponse | null;
  nodes?: Array<{ node_id: string; name: string; depth_cm: number; risk_level: string }>;
  nodeList: { id: string; name: string }[];
  loading: boolean;
  isAutoSim?: boolean;
  autoSimStep?: number;
  onStartAutoSim?: () => void;
  onStopAutoSim?: () => void;
}

export default function Sidebar({
  rainMm,
  onRainChange,
  minutes,
  onMinutesChange,
  summary,
  rainData,
  chokeMode,
  onChokeModeToggle,
  blockedNodes,
  onClearBlockedNodes,
  onUnblockNode,
  showRoute,
  onRouteToggle,
  routeSource,
  routeTarget,
  onRouteSourceChange,
  onRouteTargetChange,
  routeResult = null,
  nodes = [],
  nodeList,
  loading,
  isAutoSim = false,
  autoSimStep = 0,
  onStartAutoSim,
  onStopAutoSim,
}: SidebarProps) {
  const riskData = summary
    ? [
        { name: 'Critical', value: summary.risk_breakdown.CRITICAL, color: '#ef4444' },
        { name: 'High', value: summary.risk_breakdown.HIGH, color: '#f97316' },
        { name: 'Medium', value: summary.risk_breakdown.MEDIUM, color: '#f59e0b' },
        { name: 'Low', value: summary.risk_breakdown.LOW, color: '#06b6d4' },
        { name: 'Safe', value: summary.risk_breakdown.SAFE, color: '#10b981' },
      ]
    : [];

  const totalNodes = summary?.total_nodes || 1;

  // Fast O(1) map lookup for hospital depth calculations
  const nodeDepthMap = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      m.set(nodes[i].node_id, nodes[i].depth_cm);
    }
    return m;
  }, [nodes]);

  // Live clock
  const [clockStr, setClockStr] = useState(() =>
    new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setClockStr(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Derived stat card severity values
  const maxDepth = summary?.max_depth_cm ?? 0;
  const criticalCount = summary?.risk_breakdown?.CRITICAL ?? 0;
  const highCount = summary?.risk_breakdown?.HIGH ?? 0;
  const floodedCount = summary?.flooded_nodes ?? 0;

  // SVG Donut helper
  function buildDonut(segments: { pct: number; color: string }[], size = 70, stroke = 12) {
    const r = (size - stroke) / 2;
    const cx = size / 2;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    return (
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        {segments.map((seg, i) => {
          const dashArray = `${(seg.pct / 100) * circ} ${circ}`;
          const el = (
            <circle
              key={i}
              cx={cx} cy={cx} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={dashArray}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          );
          offset += (seg.pct / 100) * circ;
          return el;
        })}
      </svg>
    );
  }

  // Filter dropdown to primary landmark corridors & hospitals (avoiding 6000+ DOM option elements)
  const dropdownLandmarkNodes = useMemo(() => {
    return nodeList.filter(
      n => !n.id.startsWith('mesh_') && !n.id.includes('_wp') && !TOP_15_DESTINATIONS.some(d => d.id === n.id)
    );
  }, [nodeList]);

  return (
    <aside className="sidebar">
      {/* ─── Brand ─── */}
      <div className="sidebar-brand">
        <div className="brand-title">
          <div className="brand-icon">🌊</div>
          <div>
            <div className="brand-name">AGASTYA</div>
            <div className="brand-subtitle">Urban Flood Nowcasting</div>
          </div>
        </div>
      </div>

      {/* ─── Live Clock + Status Row ─── */}
      <div className="sidebar-timestamp">
        <div className="live-clock">
          <div className="live-clock-dot" />
          {clockStr}
        </div>
        <span style={{ fontSize: 9, color: '#334155' }}>
          {loading ? '⏳ Computing...' : `${nodes.length.toLocaleString()} nodes live`}
        </span>
      </div>

      {/* ─── Animated 4-Stat KPI Grid ─── */}
      <div className="stat-grid-4">
        <StatCard
          icon="🌧️"
          label="Rain Rate"
          value={rainMm}
          unit="mm/hr"
          severity={rainMm >= 65 ? 'critical' : rainMm >= 35 ? 'high' : rainMm >= 15 ? 'medium' : 'safe'}
          compact
        />
        <StatCard
          icon="💧"
          label="Max Depth"
          subLabel="Minto Sag"
          value={maxDepth}
          unit="cm"
          severity={maxDepth >= 30 ? 'critical' : maxDepth >= 20 ? 'high' : maxDepth >= 10 ? 'medium' : 'safe'}
          compact
        />
        <StatCard
          icon="🚨"
          label="Critical+High"
          value={criticalCount + highCount}
          unit="nodes"
          severity={(criticalCount + highCount) > 0 ? 'critical' : 'safe'}
          compact
        />
        <StatCard
          icon="🌊"
          label="Flooded"
          value={floodedCount}
          unit="sectors"
          severity={floodedCount > 10 ? 'high' : floodedCount > 0 ? 'medium' : 'safe'}
          compact
        />
      </div>

      {/* ─── SVG Risk Donut ─── */}
      {summary && (
        <div className="risk-donut-wrap">
          {buildDonut([
            { pct: (summary.risk_breakdown.CRITICAL / Math.max(summary.total_nodes, 1)) * 100, color: '#ef4444' },
            { pct: (summary.risk_breakdown.HIGH / Math.max(summary.total_nodes, 1)) * 100, color: '#f97316' },
            { pct: (summary.risk_breakdown.MEDIUM / Math.max(summary.total_nodes, 1)) * 100, color: '#f59e0b' },
            { pct: (summary.risk_breakdown.LOW / Math.max(summary.total_nodes, 1)) * 100, color: '#06b6d4' },
            { pct: (summary.risk_breakdown.SAFE / Math.max(summary.total_nodes, 1)) * 100, color: '#10b981' },
          ])}
          <div className="risk-donut-legend">
            {[
              { label: 'Critical', val: summary.risk_breakdown.CRITICAL, color: '#ef4444' },
              { label: 'High', val: summary.risk_breakdown.HIGH, color: '#f97316' },
              { label: 'Medium', val: summary.risk_breakdown.MEDIUM, color: '#f59e0b' },
              { label: 'Low', val: summary.risk_breakdown.LOW, color: '#06b6d4' },
              { label: 'Safe', val: summary.risk_breakdown.SAFE, color: '#10b981' },
            ].map(item => (
              <div key={item.label} className="risk-donut-legend-item">
                <div className="risk-donut-dot" style={{ background: item.color }} />
                <span style={{ color: '#475569' }}>{item.label}:</span>
                <span style={{ color: item.color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{item.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Main Auto Emergency Simulation Button ─── */}
      <div style={{ padding: '0 16px 14px' }}>
        <button
          type="button"
          id="main-simulation-btn"
          onClick={isAutoSim ? onStopAutoSim : onStartAutoSim}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 10,
            background: isAutoSim
              ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
              : 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #ec4899 100%)',
            border: isAutoSim ? '1.5px solid #fca5a5' : '1.5px solid rgba(255, 255, 255, 0.3)',
            color: '#ffffff',
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: '0.4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: isAutoSim
              ? '0 0 24px rgba(239, 68, 68, 0.7)'
              : '0 6px 20px rgba(99, 102, 241, 0.45)',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <span style={{ fontSize: 16 }}>{isAutoSim ? '⏹️' : '🚨'}</span>
          <span>
            {isAutoSim
              ? `End Simulation (Step ${autoSimStep}/5)`
              : 'Run Auto Emergency Simulation'}
          </span>
        </button>
        {isAutoSim && (
          <div
            style={{
              marginTop: 6,
              fontSize: 10.5,
              color: '#fca5a5',
              textAlign: 'center',
              fontWeight: 700,
              background: 'rgba(239, 68, 68, 0.15)',
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            ⚡ Auto Simulation Running • Real Ambulance Route to AIIMS
          </div>
        )}
      </div>

      {/* ─── 15 Hospital Destinations & Emergency Corridor Selector (Always Open & O(1) Cached) ─── */}
      <div style={{ padding: '0 16px 14px' }}>
        <div
          className="glass-card"
          style={{
            border: '1.5px solid rgba(99, 102, 241, 0.4)',
            background: 'linear-gradient(180deg, rgba(30, 27, 75, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>🏥</span>
              <span style={{ fontWeight: 800, fontSize: 12, color: '#f8fafc' }}>
                15 Emergency Hospital Hubs
              </span>
            </div>
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                fontWeight: 700,
                border: '1px solid rgba(56, 189, 248, 0.4)',
              }}
              title="All 15 combinations pre-cached in memory for O(1) <1ms retrieval"
            >
              ⚡ In-Memory Cache
            </span>
          </div>

          {/* 🌟 3 Featured Jury Showcase Demos (Rajiv Chowk / CP Origin) */}
          <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>🌟 Rajiv Chowk Hospital Demos</span>
              <span style={{ fontSize: 9, color: '#10b981', fontWeight: 800 }}>Choke-Ready</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <button
                type="button"
                onClick={() => {
                  onRouteSourceChange('cp_outer_n');
                  onRouteTargetChange('rml_hospital');
                  if (!showRoute) onRouteToggle();
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: routeTarget === 'rml_hospital' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.12)',
                  background: routeTarget === 'rml_hospital' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.04)',
                  color: routeTarget === 'rml_hospital' ? '#34d399' : '#f1f5f9',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>🏥 1. RML Hospital (2.6 km)</span>
                <span style={{ fontSize: 9, background: 'rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '1px 5px', borderRadius: 4 }}>BKS Marg Choke</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onRouteSourceChange('cp_outer_n');
                  onRouteTargetChange('aiims_delhi');
                  if (!showRoute) onRouteToggle();
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: routeTarget === 'aiims_delhi' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.12)',
                  background: routeTarget === 'aiims_delhi' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.04)',
                  color: routeTarget === 'aiims_delhi' ? '#a5b4fc' : '#f1f5f9',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>🏥 2. AIIMS Apex Trauma (9.2 km)</span>
                <span style={{ fontSize: 9, background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', padding: '1px 5px', borderRadius: 4 }}>South Corridor</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onRouteSourceChange('cp_outer_n');
                  onRouteTargetChange('lady_hardinge');
                  if (!showRoute) onRouteToggle();
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: routeTarget === 'lady_hardinge' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.12)',
                  background: routeTarget === 'lady_hardinge' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.04)',
                  color: routeTarget === 'lady_hardinge' ? '#fbbf24' : '#f1f5f9',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>🏥 3. Lady Hardinge (0.9 km)</span>
                <span style={{ fontSize: 9, background: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24', padding: '1px 5px', borderRadius: 4 }}>CP West Ingress</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Origin Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label
                htmlFor="route-source"
                style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                <span>Dispatch Origin (Ambulance Base / Sector)</span>
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  id="route-source"
                  value={routeSource}
                  onChange={(e) => onRouteSourceChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'rgba(15, 23, 42, 0.85)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 8,
                    color: '#f1f5f9',
                    fontSize: 12,
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {nodeList.map(n => (
                    <option key={n.id} value={n.id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Swap Origin & Destination Button */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '-2px 0' }}>
              <button
                type="button"
                onClick={() => {
                  const temp = routeSource;
                  onRouteSourceChange(routeTarget);
                  onRouteTargetChange(temp);
                }}
                title="Swap Origin and Destination"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 6,
                  color: '#94a3b8',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.15s',
                }}
              >
                <span>⇅</span>
                <span>Swap Direction</span>
              </button>
            </div>

            {/* Destination Selection with 15 Emergency Hospital Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label
                htmlFor="route-target"
                style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
                <span>Destination (15 Hospitals & Key Exits)</span>
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  id="route-target"
                  value={routeTarget}
                  onChange={(e) => onRouteTargetChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1.5px solid rgba(99, 102, 241, 0.6)',
                    borderRadius: 8,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 700,
                    outline: 'none',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <optgroup label="⭐ Top 15 Apex Hospitals & Trauma Hubs (Fast In-Memory Cache)">
                    {TOP_15_DESTINATIONS.map(d => {
                      const depth = nodeDepthMap.get(d.id) ?? 0;
                      const status = depth > 15.0 ? '🚨 INUNDATED' : '🟢 PASSABLE';
                      return (
                        <option key={d.id} value={d.id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                          {d.icon} {d.name} ({status} - {depth.toFixed(1)}cm)
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="📍 Primary Landmark Corridors & Intersections">
                    {dropdownLandmarkNodes.map(n => (
                      <option key={n.id} value={n.id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                        {n.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Quick 15 Emergency Hospital Badges / 1-Click Fast Select */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#94a3b8' }}>
                  <span style={{ fontWeight: 700 }}>⚡ 1-Click Hospital Presets:</span>
                  <span style={{ color: '#38bdf8', fontSize: 9 }}>15 Pre-Warmed O(1)</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    maxHeight: 110,
                    overflowY: 'auto',
                    padding: '4px',
                    background: 'rgba(15, 23, 42, 0.5)',
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  {TOP_15_DESTINATIONS.map((d) => {
                    const isSelected = routeTarget === d.id;
                    const depth = nodeDepthMap.get(d.id) ?? 0;
                    const isFlooded = depth > 15.0;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onRouteTargetChange(d.id)}
                        style={{
                          fontSize: 9.5,
                          padding: '3px 7px',
                          borderRadius: 5,
                          border: isSelected
                            ? '1px solid #6366f1'
                            : isFlooded
                            ? '1px solid rgba(239, 68, 68, 0.4)'
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          background: isSelected
                            ? 'rgba(99, 102, 241, 0.35)'
                            : isFlooded
                            ? 'rgba(239, 68, 68, 0.12)'
                            : 'rgba(30, 41, 59, 0.6)',
                          color: isSelected ? '#ffffff' : isFlooded ? '#fca5a5' : '#cbd5e1',
                          cursor: 'pointer',
                          fontWeight: isSelected ? 800 : 500,
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                        title={`${d.name} (${d.area}) - ${d.badge}`}
                      >
                        <span>{d.icon}</span>
                        <span>{d.name.split(' ')[0]}</span>
                        {isFlooded && <span style={{ color: '#ef4444', fontSize: 8 }}>⛔</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Route Status Card */}
            {routeResult && routeResult.reachable && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  fontSize: 10.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#34d399', fontWeight: 800 }}>
                    🟢 {routeResult.is_rerouted ? 'Flood Bypass Corridor' : 'Direct Passable Corridor'}
                  </span>
                  <span style={{ color: '#38bdf8', fontWeight: 800 }}>
                    {routeResult.distance_m} m
                  </span>
                </div>
                <div style={{ fontSize: 9.5, color: '#94a3b8' }}>
                  ETA: ~{Math.ceil(routeResult.eta_safe_sec)}s | Clearance: &le;15cm | In-Memory Speed: &lt;1ms
                </div>
              </div>
            )}

            {/* AI Route Justification & Alternate Routes Comparison Card */}
            {routeResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🧠 AI Route Justification & Comparison:</span>
                </div>

                {/* Safe Route Summary */}
                <div
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    fontSize: 9.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', fontWeight: 800 }}>
                    <span>✅ Chosen Safe Path</span>
                    <span>{routeResult.distance_m} m</span>
                  </div>
                  <div style={{ color: '#cbd5e1', marginTop: 2 }}>
                    Peak Water: <strong>{routeResult.safe_max_depth_cm || 0} cm</strong> (&le;15cm clearance). Zero engine risk.
                  </div>
                </div>

                {/* Alternate Submerged Corridors */}
                {routeResult.alternate_routes && routeResult.alternate_routes.map((alt, idx) => (
                  <div
                    key={alt.id || idx}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      fontSize: 9.5,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fca5a5', fontWeight: 800 }}>
                      <span>❌ {alt.name}</span>
                      <span>{alt.distance_m} m</span>
                    </div>
                    <div style={{ color: '#f87171', fontWeight: 700, marginTop: 2 }}>
                      Predicted Water Level: {alt.max_depth_cm.toFixed(1)} cm
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 9, marginTop: 2 }}>
                      {alt.reason_rejected}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Rainfall Intensity Slider (Animated) ─── */}
      <RainSlider value={rainMm} onChange={onRainChange} label="1. Rainfall Rate (Intensity)" />

        {/* ─── Storm Duration Accumulation Slider ─── */}
      <div style={{ padding: '0 16px 14px', marginTop: -4 }}>
          <div className="section-title">2. Storm Duration (Accumulation Time)</div>
          <div className="slider-header" style={{ marginBottom: 4 }}>
            <div>
              <span className="slider-value" style={{ color: 'var(--accent-cyan)' }}>{minutes}</span>
              <span className="slider-unit">min</span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Total Volume: {((rainMm * (minutes / 60)).toFixed(1))} mm total
            </span>
          </div>
          <input
            type="range"
            min="5"
            max="120"
            step="5"
            value={minutes}
            onChange={(e) => onMinutesChange(Number(e.target.value))}
            className="rain-slider"
            style={{ background: 'linear-gradient(90deg, #06b6d4, #8b5cf6)' }}
            id="duration-slider"
          />
          <div className="slider-labels" style={{ marginBottom: 8 }}>
            <span>5m</span>
            <span>30m</span>
            <span>60m</span>
            <span>90m</span>
            <span>120m</span>
          </div>
          {/* Quick preset buttons */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[15, 30, 45, 60, 90].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMinutesChange(m)}
                style={{
                  flex: 1,
                  padding: '3px 0',
                  fontSize: 10,
                  borderRadius: 4,
                  border: minutes === m ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                  background: minutes === m ? 'rgba(6, 182, 212, 0.2)' : 'var(--bg-glass)',
                  color: minutes === m ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: minutes === m ? 700 : 500,
                }}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

      {/* ─── Dashboard Stats ─── */}
      <div className="section-title" style={{ paddingLeft: 20 }}>Catchment Analytics (Hydraulic Estimate)</div>
      <div className="stats-grid">

        <div className="glass-card stat-red">
          <div className="glass-card-title">Max Depth</div>
          <div className="glass-card-value">
            {summary ? summary.max_depth_cm.toFixed(1) : '—'}
          </div>
          <div className="glass-card-label">cm (Underpass)</div>
        </div>
        <div className="glass-card stat-amber">
          <div className="glass-card-title">Avg Depth</div>
          <div className="glass-card-value">
            {summary ? summary.avg_depth_cm.toFixed(1) : '—'}
          </div>
          <div className="glass-card-label">cm (all streets)</div>
        </div>
        <div className="glass-card stat-blue">
          <div className="glass-card-title">Flooded</div>
          <div className="glass-card-value">
            {summary ? summary.flooded_nodes : '—'}
          </div>
          <div className="glass-card-label">
            of {summary ? summary.total_nodes : '—'} nodes
          </div>
        </div>
        <div className="glass-card stat-cyan">
          <div className="glass-card-title">Avg Flooded</div>
          <div className="glass-card-value">
            {summary ? summary.avg_flooded_depth_cm.toFixed(1) : '—'}
          </div>
          <div className="glass-card-label">cm depth</div>
        </div>
      </div>

      {/* ─── Risk Breakdown Chart ─── */}
      {summary && (
        <div className="sidebar-section">
          <div className="section-title">Risk Severity Breakdown</div>
          <div className="glass-card" style={{ padding: 8 }}>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={riskData} barSize={22}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#64748b', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: '#111827',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: '#f1f5f9' }}
                  itemStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {riskData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {/* Mini risk bar */}
            <div className="risk-breakdown">
              {summary.risk_breakdown.CRITICAL > 0 && (
                <div className="risk-bar risk-bar-critical"
                  style={{ width: `${(summary.risk_breakdown.CRITICAL / totalNodes) * 100}%` }} />
              )}
              {summary.risk_breakdown.HIGH > 0 && (
                <div className="risk-bar risk-bar-high"
                  style={{ width: `${(summary.risk_breakdown.HIGH / totalNodes) * 100}%` }} />
              )}
              {summary.risk_breakdown.MEDIUM > 0 && (
                <div className="risk-bar risk-bar-medium"
                  style={{ width: `${(summary.risk_breakdown.MEDIUM / totalNodes) * 100}%` }} />
              )}
              {summary.risk_breakdown.LOW > 0 && (
                <div className="risk-bar risk-bar-low"
                  style={{ width: `${(summary.risk_breakdown.LOW / totalNodes) * 100}%` }} />
              )}
              {summary.risk_breakdown.SAFE > 0 && (
                <div className="risk-bar risk-bar-safe"
                  style={{ width: `${(summary.risk_breakdown.SAFE / totalNodes) * 100}%` }} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Controls ─── */}
      <div className="sidebar-section">
        <div className="section-title">Simulation Controls</div>

        {/* Choke mode toggle */}
        <div className="glass-card" style={{ borderColor: chokeMode ? 'rgba(239, 68, 68, 0.4)' : undefined }}>
          <div className="toggle-container">
            <span className="toggle-label" style={{ fontWeight: 600 }}>
              🔴 Choke Simulation (Multi-Node)
            </span>
            <div
              className={`toggle-switch ${chokeMode ? 'active' : ''}`}
              onClick={onChokeModeToggle}
              style={{ background: chokeMode ? '#ef4444' : undefined }}
              id="choke-toggle"
            />
          </div>

          {chokeMode && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: blockedNodes.length > 0 ? '#ef4444' : 'var(--text-muted)', fontWeight: 600 }}>
                  {blockedNodes.length > 0
                    ? `🚫 ${blockedNodes.length} Manhole${blockedNodes.length > 1 ? 's' : ''} Blocked`
                    : 'Click any nodes on map to block'}
                </span>
                {blockedNodes.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearBlockedNodes}
                    className="btn btn-sm"
                    style={{
                      padding: '2px 8px',
                      fontSize: 10,
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      cursor: 'pointer',
                    }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {blockedNodes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0 8px', maxHeight: 120, overflowY: 'auto' }}>
                  {blockedNodes.map(id => {
                    const nodeName = nodeList.find(n => n.id === id)?.name || id;
                    return (
                      <div
                        key={id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          fontSize: 11,
                        }}
                      >
                        <span style={{ color: '#fca5a5', fontWeight: 600, fontSize: 10 }}>🚫 {nodeName}</span>
                        {onUnblockNode && (
                          <button
                            type="button"
                            onClick={() => onUnblockNode(id)}
                            style={{
                              background: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: 4,
                              padding: '2px 6px',
                              fontSize: 9,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Unblock
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Click any manhole markers on the map to block or unblock. Multiple manholes can be blocked simultaneously to simulate network-wide silt clogs.
              </div>
            </div>
          )}

          {!chokeMode && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Enable to simulate debris & silt blockages across multiple manholes.
            </div>
          )}
        </div>
      </div>

      {/* ─── Live Rain Data ─── */}
      {rainData && (
        <div className="sidebar-section">
          <div className="section-title">Live Weather Feed</div>
          <div className="glass-card stat-cyan">
            <div className="glass-card-title">Current Rain (Open-Meteo)</div>
            <div className="glass-card-value">{rainData.current_rain_mm}</div>
            <div className="glass-card-label">mm/hr at Minto Bridge</div>
          </div>
          <div className="glass-card">
            <div className="glass-card-title">Atmospheric Conditions</div>
            <div className="glass-card-value" style={{ color: 'var(--accent-amber)', fontSize: 18 }}>
              {rainData.current_temperature_c}°C
            </div>
            <div className="glass-card-label">Wind: {rainData.wind_speed_kmh} km/h</div>
          </div>
        </div>
      )}

      {/* ─── Footer ─── */}
      <div style={{
        marginTop: 'auto',
        padding: '12px 16px',
        borderTop: '1px solid var(--border-subtle)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          SIH 2026 · Problem Statement 26085
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
          Synthetic Drainage Proxy (PySewer) · DEM Elevations
        </div>
        <div style={{ fontSize: 9, color: '#38bdf8', marginTop: 1, fontWeight: 600 }}>
          Minto Bridge, New Delhi · {loading ? '⏳ Computing...' : '✅ Online'}
        </div>
      </div>
    </aside>
  );
}

