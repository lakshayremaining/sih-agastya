import { useState, useEffect } from 'react';
import type { NodeDepth, RouteResponse, PysewerStatusResponse, PysewerSynthesizeResponse } from '../lib/api';
import { fetchPysewerStatus, synthesizePysewer } from '../lib/api';

interface AlertPanelProps {
  nodes: NodeDepth[];
  routeResult: RouteResponse | null;
  showRoute: boolean;
}

interface Alert {
  id: string;
  node_id?: string;
  level: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  depth_cm?: number;
  description: string;
  time: string;
}

function buildAlerts(nodes: NodeDepth[]): Alert[] {
  const list: Alert[] = [];
  const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  nodes
    .filter(n => n.risk_level === 'CRITICAL')
    .forEach(n =>
      list.push({
        id: `crit-${n.node_id}`,
        node_id: n.node_id,
        level: 'critical',
        title: n.name,
        depth_cm: n.depth_cm,
        description: `Critical water depth: ${n.depth_cm.toFixed(1)} cm. Road submerged.`,
        time: t,
      })
    );

  nodes
    .filter(n => n.risk_level === 'HIGH')
    .forEach(n =>
      list.push({
        id: `high-${n.node_id}`,
        node_id: n.node_id,
        level: 'high',
        title: n.name,
        depth_cm: n.depth_cm,
        description: `High water depth: ${n.depth_cm.toFixed(1)} cm. Impassable.`,
        time: t,
      })
    );

  return list;
}

export default function AlertPanel({ nodes, routeResult, showRoute }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>(() => buildAlerts(nodes));
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<'alerts' | 'route' | 'catchment'>('alerts');

  // PySewer / Catchment state
  const [pysewerStatus, setPysewerStatus] = useState<PysewerStatusResponse | null>(null);
  const [pysewerData, setPysewerData] = useState<PysewerSynthesizeResponse | null>(null);

  useEffect(() => {
    setAlerts(buildAlerts(nodes));
  }, [nodes]);

  useEffect(() => {
    if (showRoute && routeResult) {
      setActiveTab('route');
    }
  }, [showRoute, routeResult]);

  useEffect(() => {
    async function loadCatchment() {
      try {
        const s = await fetchPysewerStatus();
        setPysewerStatus(s);
        const synth = await synthesizePysewer(35);
        setPysewerData(synth);
      } catch (e) {
        console.warn('Catchment analysis load fallback:', e);
      }
    }
    loadCatchment();
  }, []);

  const critCount = nodes.filter(n => n.risk_level === 'CRITICAL').length;

  return (
    <div
      style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 999999 }}
      className="flex flex-col items-end pointer-events-auto"
      onMouseEnter={() => setMinimized(false)}
    >
      {/* ─── Pop-up Monitor Window (Opens on Hover) ─── */}
      {!minimized && (
        <div className="mb-3 w-96 max-w-[calc(100vw-32px)] bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${critCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
              <h3 className="font-bold text-xs text-slate-200">AGASTYA Intelligence Monitor</h3>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(true);
              }}
              className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold">
        <button
          onClick={() => setActiveTab('alerts')}
          className={`flex-1 py-2 ${activeTab === 'alerts' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400'}`}
        >
          🚨 Alerts ({alerts.length})
        </button>
        <button
          onClick={() => setActiveTab('route')}
          className={`flex-1 py-2 ${activeTab === 'route' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-400'}`}
        >
          🚑 Safe Route
        </button>
        <button
          onClick={() => setActiveTab('catchment')}
          className={`flex-1 py-2 ${activeTab === 'catchment' ? 'text-purple-400 border-b-2 border-purple-500' : 'text-slate-400'}`}
        >
          🌊 Catchment Analysis
        </button>
      </div>

      {/* Content */}
      <div className="p-3 max-h-80 overflow-y-auto space-y-2 text-xs">
        {activeTab === 'alerts' && (
          <div>
            {alerts.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                ✅ No critical flood inundation reported.
              </div>
            ) : (
              alerts.map(a => (
                <div key={a.id} className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 mb-2 space-y-1">
                  <div className="flex justify-between font-bold text-red-400">
                    <span>{a.title}</span>
                    <span>{a.depth_cm?.toFixed(1)} cm</span>
                  </div>
                  <p className="text-[11px] text-slate-300">{a.description}</p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'route' && (
          <div>
            {routeResult ? (
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-2">
                <div className="flex justify-between font-bold text-emerald-400">
                  <span>Ambulance Status</span>
                  <span>{routeResult.is_rerouted ? 'Rerouted' : 'Direct Route'}</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-1">
                  <p>• Distance: <strong>{(routeResult.distance_m / 1000).toFixed(2)} km</strong></p>
                  <p>• Max Path Water Depth: <strong>{(routeResult.safe_max_depth_cm ?? 0).toFixed(1)} cm</strong></p>
                  <p>• Safety Wading Threshold: <strong>15.0 cm</strong></p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">
                Select a starting location in the sidebar to generate safe route analysis.
              </p>
            )}
          </div>
        )}

        {/* ONLY ONE Single Working Catchment Analysis Section */}
        {activeTab === 'catchment' && (
          <div className="p-3 bg-slate-800/60 rounded-xl border border-purple-500/30 space-y-2 text-[11px]">
            <div className="flex justify-between font-bold text-purple-300 border-b border-slate-700 pb-1.5">
              <span>Minto Bridge Catchment Profile</span>
              <span className="text-emerald-400 font-mono">{pysewerStatus?.standards || 'CPHEEO Standard'}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-slate-300 pt-1">
              <div className="bg-slate-900 p-2 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Sag Point Elevation:</span>
                <span className="font-bold text-amber-400">210.5 m</span>
              </div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Ridgeline Elevation:</span>
                <span className="font-bold text-blue-400">216.5 m</span>
              </div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">PySewer Conduits:</span>
                <span className="font-bold text-purple-400">{pysewerData?.total_pipes ?? nodes.length} Pipes</span>
              </div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Conduit Slopes:</span>
                <span className="font-bold text-emerald-400">S ≥ 0.002</span>
              </div>
            </div>

            <div className="pt-2 text-slate-400 text-[10px]">
              Surface runoff cascades from CP ridgelines (216.5m) into Minto Underpass sag (210.5m). Pipe layout synthesized via PySewer gravity engine.
            </div>
            {pysewerData?.pipes && pysewerData.pipes.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="font-bold text-slate-300 border-b border-slate-700 pb-1 mb-1">
                  Synthesized Pipe Layout
                </div>
                {pysewerData.pipes.map((pipe, idx) => (
                  <div key={idx} className="bg-slate-900/80 p-2 rounded border border-slate-800 flex flex-col gap-1">
                    <div className="font-semibold text-blue-300">
                      {pipe.from_name || pipe.from_node} ➔ {pipe.to_name || pipe.to_node}
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-400">
                      <div>Length: <span className="text-slate-200">{pipe.length_m.toFixed(1)}m</span></div>
                      <div>Diameter: <span className="text-slate-200">{pipe.diameter_mm.toFixed(0)}mm</span></div>
                      <div>Slope: <span className="text-emerald-400">{pipe.slope_pct.toFixed(2)}%</span></div>
                      <div>Velocity: <span className="text-amber-400">{pipe.velocity_ms.toFixed(2)} m/s</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )}

  {/* ─── Bottom-Center Trigger Button ─── */}
  <button
    onMouseEnter={() => setMinimized(false)}
    onClick={() => setMinimized(prev => !prev)}
    className={`px-5 py-2.5 text-white border rounded-full shadow-2xl flex items-center gap-2.5 text-xs font-bold transition-all duration-200 hover:scale-105 cursor-pointer backdrop-blur-md ${
      !minimized
        ? 'bg-blue-600 border-blue-400 shadow-blue-500/20'
        : 'bg-slate-900/95 border-slate-700/80 hover:border-blue-500'
    }`}
  >
    <span className={`w-2.5 h-2.5 rounded-full ${critCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
    <span>🌊 AGASTYA Intelligence Monitor</span>
    {alerts.length > 0 && (
      <span className="px-2 py-0.5 text-[10px] bg-red-500 text-white rounded-full font-extrabold">
        {alerts.length}
      </span>
    )}
  </button>
</div>
  );
}
