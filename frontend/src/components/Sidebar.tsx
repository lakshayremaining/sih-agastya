import { useState, useEffect } from 'react';
import type { FloodSummary, RainResponse } from '../lib/api';
import { STARTING_LOCATIONS_12 } from '../lib/networkData';
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
  chokeMode?: boolean;
  onChokeModeToggle?: () => void;
  blockedNodes?: string[];
  onClearBlockedNodes?: () => void;
  showRoute?: boolean;
  onRouteToggle?: () => void;
  routeSource: string;
  onRouteSourceChange: (v: string) => void;
  routeResult?: import('../lib/api').RouteResponse | null;
  nodes?: Array<{ node_id: string; name: string; depth_cm: number; risk_level: string }>;
  nodeList: { id: string; name: string }[];
  loading: boolean;
  onOpenDrawer?: () => void;
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
  routeSource,
  onRouteSourceChange,
  routeResult = null,
  nodes = [],
  loading,
  onOpenDrawer,
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

  const maxDepth = summary?.max_depth_cm ?? 0;
  const criticalCount = summary?.risk_breakdown?.CRITICAL ?? 0;
  const highCount = summary?.risk_breakdown?.HIGH ?? 0;
  const floodedCount = summary?.flooded_nodes ?? 0;

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="brand-title">
          <div className="brand-icon">🌊</div>
          <div>
            <div className="brand-name">AGASTYA</div>
            <div className="brand-subtitle">Urban Flood Nowcasting</div>
          </div>
        </div>
      </div>

      {/* Live Clock + Status */}
      <div className="sidebar-timestamp">
        <div className="live-clock">
          <div className="live-clock-dot" />
          {clockStr}
        </div>
        <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>
          {loading ? '⏳ Computing...' : `${nodes.length} nodes active`}
        </span>
      </div>

      {/* Auto Emergency Simulation Button */}
      <div style={{ padding: '0 16px 10px' }}>
        <button
          type="button"
          onClick={isAutoSim ? onStopAutoSim : onStartAutoSim}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            background: isAutoSim ? '#dc2626' : '#2563eb',
            border: 'none',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
            transition: 'background 0.2s ease',
          }}
        >
          <span>{isAutoSim ? '⏹️' : '🚨'}</span>
          <span>
            {isAutoSim ? `End Simulation (Step ${autoSimStep}/5)` : 'Run Auto Emergency Simulation'}
          </span>
        </button>
      </div>

      {/* Math Basis Drawer Button */}
      <div style={{ padding: '0 16px 10px' }}>
        <button
          type="button"
          onClick={onOpenDrawer}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#94a3b8',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.2s ease',
          }}
        >
          <span>🧮</span>
          <span>Math Calculation Basis & Rationale</span>
        </button>
      </div>

      {/* 4-Stat KPI Grid */}
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
          subLabel="Sag Point"
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

      {/* Starting Location Dropdown (Curated 12 Locations) */}
      <div style={{ padding: '0 16px 12px' }}>
        <div
          className="glass-card"
          style={{
            border: '1px solid rgba(99, 102, 241, 0.3)',
            background: 'rgba(15, 23, 42, 0.8)',
            padding: 12,
          }}
        >
          <label
            htmlFor="route-source"
            style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span>Select Dispatch Starting Location (14 Hubs)</span>
          </label>

          <select
            id="route-source"
            value={routeSource}
            onChange={(e) => onRouteSourceChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="" style={{ background: '#0f172a', color: '#64748b' }}>— Select Starting Location —</option>
            {STARTING_LOCATIONS_12.map((loc: any) => (
              <option key={loc.id} value={loc.id} style={{ background: '#0f172a', color: '#f1f5f9' }}>
                {loc.name} ({loc.area})
              </option>
            ))}
          </select>

          {/* Route Status Result */}
          {routeResult && (
            <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', fontWeight: 700 }}>
                <span>🚑 Safe Path: {(routeResult.distance_m / 1000).toFixed(2)} km</span>
                <span style={{ color: '#38bdf8' }}>Max Depth: {(routeResult.safe_max_depth_cm ?? 0).toFixed(1)} cm</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sliders */}
      <RainSlider value={rainMm} onChange={onRainChange} label="1. Rainfall Rate (Intensity)" />

      <div style={{ padding: '0 16px 14px', marginTop: -4 }}>
        <div className="section-title">2. Storm Duration (Accumulation)</div>
        <div className="slider-header" style={{ marginBottom: 4 }}>
          <div>
            <span className="slider-value" style={{ color: 'var(--accent-cyan)' }}>{minutes}</span>
            <span className="slider-unit">min</span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Total: {(rainMm * (minutes / 60)).toFixed(1)} mm
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
        <div className="slider-labels">
          <span>5m</span>
          <span>30m</span>
          <span>60m</span>
          <span>90m</span>
          <span>120m</span>
        </div>
      </div>

      {/* Risk Severity Breakdown Chart */}
      {summary && (
        <div className="sidebar-section">
          <div className="section-title">Risk Severity Breakdown</div>
          <div className="glass-card" style={{ padding: 8 }}>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={riskData} barSize={20}>
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#111827', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {riskData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Live Weather Feed */}
      {rainData && (
        <div className="sidebar-section">
          <div className="section-title">Live Weather Feed (Open-Meteo)</div>
          <div className="glass-card stat-cyan" style={{ padding: 10 }}>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-300">Live Rain: <strong>{rainData.current_rain_mm} mm/hr</strong></span>
              <span className="text-amber-400">Temp: <strong>{rainData.current_temperature_c}°C</strong></span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Wind: {rainData.wind_speed_kmh} km/h • Station: Delhi Minto Bridge
            </div>
            <button
              type="button"
              onClick={() => {
                onRainChange(rainData.current_rain_mm);
                onMinutesChange(30);
              }}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '6px 8px',
                borderRadius: 6,
                background: 'rgba(6, 182, 212, 0.2)',
                border: '1px solid rgba(6, 182, 212, 0.4)',
                color: '#38bdf8',
                fontSize: 10.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4
              }}
            >
              <span>📡 Sync Sliders to Live Weather ({rainData.current_rain_mm} mm/hr)</span>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 'auto', padding: '10px 16px', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
        <div style={{ fontSize: 9, color: '#64748b' }}>
          AGASTYA PS 26085 • Manning Engine • DEM Sampler
        </div>
      </div>
    </aside>
  );
}
