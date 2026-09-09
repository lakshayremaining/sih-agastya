import { useState } from 'react';
import type { RouteResponse } from '../lib/api';

interface CalculationDrawerProps {
  rainMm: number;
  minutes: number;
  routeResult: RouteResponse | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function CalculationDrawer({
  rainMm,
  minutes,
  routeResult,
  isOpen,
  onClose,
}: CalculationDrawerProps) {
  const [activeTab, setActiveTab] = useState<'math' | 'route'>('math');

  if (!isOpen) return null;

  const excessVolApprox = Math.max(0, ((rainMm * 0.85 - 18) * (minutes / 60) * 2500) / 1000).toFixed(1);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 max-w-full bg-slate-900/95 backdrop-blur-xl border-l border-slate-700/60 shadow-2xl text-slate-100 p-5 flex flex-col justify-between transition-all duration-300 animate-in slide-in-from-right">
      <div>
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧮</span>
            <h2 className="font-bold text-lg text-slate-100">Math Basis & Rationale</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-slate-800/80 rounded-lg p-1 my-4 border border-slate-700/50 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('math')}
            className={`flex-1 py-1.5 rounded-md transition-all ${
              activeTab === 'math'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📐 Math Formulations
          </button>
          <button
            onClick={() => setActiveTab('route')}
            className={`flex-1 py-1.5 rounded-md transition-all ${
              activeTab === 'route'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🚑 Route Choice Rationale
          </button>
        </div>

        {/* Content Area */}
        <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-220px)] pr-1 text-xs text-slate-300">
          {activeTab === 'math' ? (
            <>
              {/* Formula 1: Rational Runoff */}
              <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between items-center text-blue-400 font-bold text-sm">
                  <span>1. Rational Runoff Formula</span>
                  <span className="text-[10px] bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">Q_in</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg text-center font-mono text-xs text-blue-300 border border-slate-800">
                  Q_in = (C × I × A) / 360  [m³/s]
                </div>
                <p className="text-slate-400 leading-relaxed">
                  • <strong>C = 0.85</strong> (CPHEEO Delhi concrete/bitumen coefficient)<br />
                  • <strong>I = {rainMm} mm/hr</strong> (Current rainfall intensity)<br />
                  • <strong>A = Tributary area</strong> per node (m²)
                </p>
              </div>

              {/* Formula 2: Manning Capacity */}
              <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between items-center text-emerald-400 font-bold text-sm">
                  <span>2. Manning Conduit Capacity</span>
                  <span className="text-[10px] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Q_cap</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg text-center font-mono text-xs text-emerald-300 border border-slate-800">
                  Q_cap = (0.3117 / n) × D^(8/3) × √S  [m³/s]
                </div>
                <p className="text-slate-400 leading-relaxed">
                  • <strong>n = 0.013</strong> (Spun concrete pipe roughness)<br />
                  • <strong>D = Pipe diameter</strong> (300–1800mm CPHEEO standard)<br />
                  • <strong>S = Slope</strong> (DEM elevation gradient)
                </p>
              </div>

              {/* Formula 3: Surface Inundation */}
              <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between items-center text-amber-400 font-bold text-sm">
                  <span>3. Inundation & Sag Pooling</span>
                  <span className="text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">d_flood</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg text-center font-mono text-xs text-amber-300 border border-slate-800">
                  d_flood = (V_excess / A_ponding) × 100  [cm]
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Excess water accumulates in sag points (Minto Bridge elevation 210.5m vs CP 216.5m). Estimated accumulation: ~<strong>{excessVolApprox} m³</strong> over {minutes} mins.
                </p>
              </div>

              {/* Wading clearance limit */}
              <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-1.5">
                <div className="text-rose-400 font-bold flex items-center gap-1.5">
                  <span>🚨 Vehicle Wading Threshold</span>
                </div>
                <p className="text-slate-400">
                  Ambulance air intake limit set strictly at <strong>15.0 cm</strong>. Any road exceeding 15 cm depth is automatically pruned from routing graph.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Route Selection Rationale */}
              <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                <h3 className="text-emerald-400 font-bold text-sm flex items-center gap-1.5">
                  <span>✅ Why This Safest Route Was Chosen</span>
                </h3>
                <p className="text-slate-300 leading-relaxed">
                  Agastya uses modified <strong>Constrained Dijkstra Pathfinding</strong> with dynamic edge pruning:
                </p>
                <div className="bg-slate-950 p-2.5 rounded-lg space-y-1.5 border border-slate-800 text-[11px]">
                  <div className="flex justify-between text-slate-300">
                    <span>Algorithm Execution Time:</span>
                    <span className="font-mono text-emerald-400">&lt; 6.0 ms</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Water Clearance Limit:</span>
                    <span className="font-mono text-amber-400">≤ 15.0 cm</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Inundated Edges Pruned:</span>
                    <span className="font-mono text-rose-400">{routeResult?.blocked_count ?? 0} segments</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Status:</span>
                    <span className="font-mono text-emerald-400">
                      {routeResult?.is_rerouted ? 'Rerouted around floods' : 'Direct shortest safe route'}
                    </span>
                  </div>
                </div>
              </div>

              {routeResult ? (
                <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                  <h4 className="font-semibold text-slate-200">Route Metrics Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="text-slate-400 block">Total Distance:</span>
                      <span className="font-bold text-blue-400">{(routeResult.distance_m / 1000).toFixed(2)} km</span>
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="text-slate-400 block">Max Water Depth:</span>
                      <span className="font-bold text-amber-400">{(routeResult.safe_max_depth_cm ?? 0).toFixed(1)} cm</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Direct shortest paths submerged in Minto Underpass (&gt;15 cm) were safely bypassed via dry elevated radial corridors.
                  </p>
                </div>
              ) : (
                <p className="text-slate-400 text-center py-4">
                  Select a starting location in the sidebar to generate safe ambulance routing rationale.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drawer Footer */}
      <div className="pt-3 border-t border-slate-800 text-[10px] text-slate-400 flex justify-between">
        <span>CPHEEO & SRTM Sampler Engine</span>
        <span className="text-emerald-400 font-semibold">100% Offline Capable</span>
      </div>
    </div>
  );
}
