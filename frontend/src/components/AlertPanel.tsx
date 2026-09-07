/**
 * Agastya — Redesigned Movable & Minimizable AlertPanel Component
 * Features:
 *   - Movable: Drag & drop anywhere across the map viewport
 *   - Minimizable: Collapse into floating draggable status pill
 *   - Structured Tabs: Active Alerts | Safe Ambulance Route | PySewer Gravity Engine
 *   - Severity Filtering: All | Critical | High
 *   - Individual Dismiss & Clear All
 *   - PySewer Architecture Inspector & Pipe Synthesis Viewer
 */

import React, { useState, useEffect, useRef } from 'react';
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
        description: `Severe inundation of ${n.depth_cm.toFixed(1)} cm. Low-point waterlogging. Road impassable.`,
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
        description: `Substantial water depth of ${n.depth_cm.toFixed(1)} cm. Avoid vehicular transit.`,
        time: t,
      })
    );

  const medNodes = nodes.filter(n => n.risk_level === 'MEDIUM');
  if (medNodes.length > 0) {
    list.push({
      id: 'medium-group',
      level: 'medium',
      title: `${medNodes.length} Moderate Surcharge Sectors`,
      description: medNodes.map(n => n.name).slice(0, 3).join(', ') + (medNodes.length > 3 ? ` +${medNodes.length - 3} others` : ''),
      time: t,
    });
  }

  const lowNodes = nodes.filter(n => n.risk_level === 'LOW');
  if (lowNodes.length > 0) {
    list.push({
      id: 'low-group',
      level: 'low',
      title: `${lowNodes.length} Minor Waterlogging Nodes`,
      description: 'Minor curb gutter accumulation. Normal traffic advisory.',
      time: t,
    });
  }

  return list;
}

const LEVEL_STYLE = {
  critical: {
    border: 'rgba(239, 68, 68, 0.4)',
    bg: 'rgba(239, 68, 68, 0.12)',
    text: '#ef4444',
    badge: '#ef4444',
    glow: '0 0 12px rgba(239, 68, 68, 0.4)',
    label: 'CRITICAL',
  },
  high: {
    border: 'rgba(249, 115, 22, 0.4)',
    bg: 'rgba(249, 115, 22, 0.12)',
    text: '#f97316',
    badge: '#f97316',
    glow: '0 0 10px rgba(249, 115, 22, 0.3)',
    label: 'HIGH RISK',
  },
  medium: {
    border: 'rgba(245, 158, 11, 0.35)',
    bg: 'rgba(245, 158, 11, 0.1)',
    text: '#f59e0b',
    badge: '#f59e0b',
    glow: 'none',
    label: 'MEDIUM',
  },
  low: {
    border: 'rgba(6, 182, 212, 0.35)',
    bg: 'rgba(6, 182, 212, 0.1)',
    text: '#06b6d4',
    badge: '#06b6d4',
    glow: 'none',
    label: 'LOW',
  },
};

export default function AlertPanel({ nodes, routeResult, showRoute }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>(() => buildAlerts(nodes));
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<'alerts' | 'route' | 'pysewer'>('alerts');
  const [filterLevel, setFilterLevel] = useState<'all' | 'critical' | 'high'>('all');

  // Priority badge helper
  function getPriorityBadge(level: Alert['level']) {
    switch (level) {
      case 'critical': return { cls: 'priority-badge priority-p1', label: 'P1', icon: '🔔' };
      case 'high':     return { cls: 'priority-badge priority-p2', label: 'P2', icon: '' };
      case 'medium':   return { cls: 'priority-badge priority-p3', label: 'P3', icon: '' };
      default:         return { cls: 'priority-badge priority-p4', label: 'P4', icon: '' };
    }
  }

  // Draggable position state
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });

  // PySewer state
  const [pysewerStatus, setPysewerStatus] = useState<PysewerStatusResponse | null>(null);
  const [pysewerData, setPysewerData] = useState<PysewerSynthesizeResponse | null>(null);
  const [pysewerLoading, setPysewerLoading] = useState(false);

  // Sync alerts when nodes change
  useEffect(() => {
    const fresh = buildAlerts(nodes);
    setAlerts(fresh.filter(a => !dismissed.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // If route is enabled, switch tab to route initially if not already set
  useEffect(() => {
    if (showRoute && routeResult) {
      setActiveTab('route');
    }
  }, [showRoute, routeResult]);

  // Load PySewer status
  const loadPysewer = async () => {
    try {
      setPysewerLoading(true);
      const status = await fetchPysewerStatus();
      setPysewerStatus(status);
      const synth = await synthesizePysewer(35);
      setPysewerData(synth);
    } catch (e) {
      console.warn('PySewer API fetch error:', e);
    } finally {
      setPysewerLoading(false);
    }
  };

  // Dragging event handlers
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      setPos({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const dismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(prev => new Set([...prev, id]));
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = new Set(alerts.map(a => a.id));
    setDismissed(prev => new Set([...prev, ...ids]));
    setAlerts([]);
  };

  const resetPosition = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPos({ x: 0, y: 0 });
  };

  const critCount = alerts.filter(a => a.level === 'critical').length;
  const highCount = alerts.filter(a => a.level === 'high').length;
  const urgentCount = critCount + highCount;

  const filteredAlerts = alerts.filter(a => {
    if (filterLevel === 'critical') return a.level === 'critical';
    if (filterLevel === 'high') return a.level === 'high';
    return true;
  });

  const isMoved = pos.x !== 0 || pos.y !== 0;

  // ─── MINIMIZED FLOATING PILL ─────────────────────────────────────
  if (minimized) {
    return (
      <div
        onMouseDown={handleDragStart}
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          zIndex: 1000,
          userSelect: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 30,
            background: urgentCount > 0 ? 'rgba(15, 23, 42, 0.92)' : 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(16px)',
            border: urgentCount > 0 ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: urgentCount > 0
              ? '0 8px 24px rgba(0,0,0,0.5), 0 0 16px rgba(239, 68, 68, 0.35)'
              : '0 8px 24px rgba(0,0,0,0.4)',
            transition: isDragging ? 'none' : 'box-shadow 0.2s',
          }}
        >
          {/* Beacon dot */}
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: urgentCount > 0 ? '#ef4444' : '#10b981',
              boxShadow: urgentCount > 0 ? '0 0 8px #ef4444' : '0 0 8px #10b981',
              display: 'inline-block',
              animation: 'pulse-dot 1.8s infinite',
            }}
          />

          <span
            onClick={() => setMinimized(false)}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: urgentCount > 0 ? '#f87171' : '#e2e8f0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{urgentCount > 0 ? '🚨 Flood Alerts' : '✅ Catchment Safe'}</span>
            <span
              style={{
                background: urgentCount > 0 ? '#ef4444' : '#10b981',
                color: 'white',
                borderRadius: 12,
                padding: '1px 7px',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {alerts.length}
            </span>
          </span>

          {showRoute && (
            <span
              onClick={() => {
                setMinimized(false);
                setActiveTab('route');
              }}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#10b981',
                fontWeight: 700,
                cursor: 'pointer',
                border: '1px solid rgba(16, 185, 129, 0.4)',
              }}
            >
              🚑 Route
            </span>
          )}

          {isMoved && (
            <button
              type="button"
              onClick={resetPosition}
              title="Reset position to top right"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 11,
                padding: '2px 4px',
              }}
            >
              ↺
            </button>
          )}

          <button
            type="button"
            onClick={() => setMinimized(false)}
            title="Expand panel"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '50%',
              width: 20,
              height: 20,
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
            }}
          >
            ↗
          </button>
        </div>
      </div>
    );
  }

  // ─── FULL REDESIGNED MOVABLE PANEL ───────────────────────────────
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        width: 350,
        maxWidth: 'calc(100vw - 28px)',
        maxHeight: 'calc(100vh - 28px)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 18,
        background: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: critCount > 0
          ? '1px solid rgba(239, 68, 68, 0.45)'
          : highCount > 0
          ? '1px solid rgba(249, 115, 22, 0.35)'
          : '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: critCount > 0
          ? '0 16px 40px rgba(0,0,0,0.6), 0 0 24px rgba(239, 68, 68, 0.25)'
          : '0 16px 40px rgba(0,0,0,0.5)',
        userSelect: isDragging ? 'none' : 'auto',
        overflow: 'hidden',
        transition: isDragging ? 'none' : 'box-shadow 0.3s, border 0.3s',
      }}
    >
      {/* ─── Top Draggable Header ───────────────────────────────── */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: '10px 14px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            title="Click and drag to move panel anywhere"
            style={{
              color: '#64748b',
              fontSize: 14,
              letterSpacing: '-1px',
              cursor: isDragging ? 'grabbing' : 'grab',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            ⠿
          </span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: critCount > 0 ? '#ef4444' : highCount > 0 ? '#f97316' : '#10b981',
              boxShadow: critCount > 0 ? '0 0 10px #ef4444' : '0 0 6px #10b981',
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc', letterSpacing: '0.02em' }}>
            Nowcast Alert Center
          </span>
          {alerts.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                background: critCount > 0 ? '#ef4444' : '#f97316',
                color: 'white',
                borderRadius: 10,
                padding: '1px 6px',
              }}
            >
              {alerts.length}
            </span>
          )}
        </div>

        {/* Header Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isMoved && (
            <button
              type="button"
              onClick={resetPosition}
              title="Reset position to top right"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8',
                borderRadius: 6,
                padding: '2px 6px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ↺ Reset
            </button>
          )}

          <button
            type="button"
            onClick={() => setMinimized(true)}
            title="Minimize to floating pill"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8',
              borderRadius: 6,
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            ─
          </button>
        </div>
      </div>

      {/* ─── Navigation Tabs ───────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.2)',
          padding: '4px 8px',
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('alerts')}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: activeTab === 'alerts' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
            color: activeTab === 'alerts' ? '#60a5fa' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          <span>🚨 Alerts</span>
          <span style={{ fontSize: 10, opacity: 0.8 }}>({alerts.length})</span>
        </button>

        {showRoute && (
          <button
            type="button"
            onClick={() => setActiveTab('route')}
            style={{
              flex: 1,
              padding: '6px 8px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s',
              background: activeTab === 'route' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
              color: activeTab === 'route' ? '#34d399' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <span>🚑 Route</span>
            <span style={{ fontSize: 9, background: '#10b981', color: 'white', borderRadius: 4, padding: '0 4px' }}>LIVE</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setActiveTab('pysewer');
            if (!pysewerStatus) {
              loadPysewer();
            }
          }}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: activeTab === 'pysewer' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
            color: activeTab === 'pysewer' ? '#c084fc' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          <span>🌐 PySewer</span>
          <span style={{ fontSize: 9, background: 'rgba(168, 85, 247, 0.3)', color: '#d8b4fe', borderRadius: 4, padding: '0 4px' }}>GIS</span>
        </button>
      </div>

      {/* ─── TAB 1: ALERTS CONTENT ─────────────────────────────── */}
      {activeTab === 'alerts' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Sub-header Filter Chips & Clear All */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setFilterLevel('all')}
                style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: filterLevel === 'all' ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
                  background: filterLevel === 'all' ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: filterLevel === 'all' ? '#f8fafc' : '#64748b',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                All ({alerts.length})
              </button>
              {critCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterLevel('critical')}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 6,
                    border: filterLevel === 'critical' ? '1px solid #ef4444' : '1px solid transparent',
                    background: filterLevel === 'critical' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                    color: '#ef4444',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  🔴 Critical ({critCount})
                </button>
              )}
              {highCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterLevel('high')}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 6,
                    border: filterLevel === 'high' ? '1px solid #f97316' : '1px solid transparent',
                    background: filterLevel === 'high' ? 'rgba(249, 115, 22, 0.2)' : 'transparent',
                    color: '#f97316',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  🟠 High ({highCount})
                </button>
              )}
            </div>

            {alerts.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#ef4444',
                  fontSize: 9,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                CLEAR ALL
              </button>
            )}
          </div>

          {/* Alert Cards List */}
          <div style={{ maxHeight: 320, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredAlerts.length === 0 ? (
              <div
                style={{
                  padding: '20px 14px',
                  textAlign: 'center',
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.05)',
                  borderRadius: 12,
                  border: '1px dashed rgba(16, 185, 129, 0.2)',
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 24 }}>✅</span>
                <span style={{ fontWeight: 700 }}>All Clear</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>No active flood risks matching current filter.</span>
              </div>
            ) : (
              filteredAlerts.map(alert => {
                const style = LEVEL_STYLE[alert.level];
                const pBadge = getPriorityBadge(alert.level);
                const isAcked = acknowledged.has(alert.id);
                return (
                  <div
                    key={alert.id}
                    className="alert-enter"
                    style={{
                      position: 'relative',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: isAcked ? 'rgba(255,255,255,0.03)' : style.bg,
                      border: `1px solid ${isAcked ? 'rgba(255,255,255,0.06)' : style.border}`,
                      boxShadow: isAcked ? 'none' : style.glow,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      transition: 'all 0.2s',
                      opacity: isAcked ? 0.55 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {/* Priority Badge */}
                        <span className={pBadge.cls} title={`Priority ${pBadge.label}`}>
                          {pBadge.label}
                        </span>
                        {pBadge.icon && <span style={{ fontSize: 10 }}>{pBadge.icon}</span>}
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: style.badge,
                            color: 'white',
                            letterSpacing: '0.03em',
                          }}
                        >
                          {style.label}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f1f5f9' }}>{alert.title}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {/* Acknowledge button */}
                        <button
                          type="button"
                          className={`ack-btn${isAcked ? ' acked' : ''}`}
                          onClick={e => { e.stopPropagation(); setAcknowledged(prev => new Set([...prev, alert.id])); }}
                          disabled={isAcked}
                          title={isAcked ? 'Acknowledged' : 'Acknowledge this alert'}
                        >
                          {isAcked ? '✓ Acked' : 'Ack'}
                        </button>
                        {/* Dismiss button */}
                        <button
                          type="button"
                          onClick={e => dismiss(alert.id, e)}
                          title="Dismiss this alert"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: 'none',
                            color: '#94a3b8',
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.35 }}>
                      {alert.description}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                      {alert.depth_cm !== undefined && (
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            color: style.text,
                            background: 'rgba(0,0,0,0.3)',
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          💧 {alert.depth_cm.toFixed(1)} cm
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginLeft: 'auto' }}>
                        {alert.time}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 2: SAFE AMBULANCE ROUTE ──────────────────────── */}
      {activeTab === 'route' && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
          {routeResult ? (
            routeResult.reachable ? (
              <>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Route Distance</span>
                    <span style={{ fontWeight: 800, color: '#f1f5f9' }}>{(routeResult.distance_m / 1000).toFixed(2)} km</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Safe ETA</span>
                    <span style={{ fontWeight: 800, color: '#10b981' }}>{Math.ceil(routeResult.eta_safe_sec / 60)} min</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Inundated Roads Avoided</span>
                    <span style={{ fontWeight: 800, color: '#ef4444' }}>{routeResult.blocked_count} sectors</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Waypoints Traversed</span>
                    <span style={{ fontWeight: 800, color: '#f1f5f9' }}>{routeResult.path.length}</span>
                  </div>
                </div>

                {routeResult.eta_saved_sec > 0 && (
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      fontSize: 11,
                      color: '#93c5fd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>⏱️</span>
                    <span>+{Math.ceil(routeResult.eta_saved_sec / 60)} min safe detour avoiding flooded underpasses</span>
                  </div>
                )}

                <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                  {routeResult.message}
                </div>
              </>
            ) : (
              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: '#f87171',
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: '#ef4444' }}>
                  <span>🔴</span>
                  <span>
                    {routeResult.reason === 'ORIGIN_UNSAFE'
                      ? 'Origin Unsafe — Deployment Infeasible'
                      : routeResult.reason === 'DESTINATION_UNSAFE'
                      ? 'Destination Unsafe — Facility Inaccessible'
                      : 'No Safe Evacuation Route Found'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#fca5a5', lineHeight: 1.4 }}>
                  {routeResult.message}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {routeResult.origin_depth_cm !== undefined && (
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: 'rgba(0,0,0,0.3)',
                        padding: '4px 8px',
                        borderRadius: 6,
                        color: routeResult.origin_depth_cm > 15.0 ? '#fca5a5' : '#86efac',
                      }}
                    >
                      Origin Depth: {routeResult.origin_depth_cm.toFixed(1)} cm
                    </div>
                  )}
                  {routeResult.destination_depth_cm !== undefined && (
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: 'rgba(0,0,0,0.3)',
                        padding: '4px 8px',
                        borderRadius: 6,
                        color: routeResult.destination_depth_cm > 15.0 ? '#fca5a5' : '#93c5fd',
                      }}
                    >
                      Destination Depth: {routeResult.destination_depth_cm.toFixed(1)} cm
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: 'rgba(0,0,0,0.3)',
                      padding: '4px 8px',
                      borderRadius: 6,
                      color: '#fecaca',
                    }}
                  >
                    Clearance Threshold: &le;15.0 cm
                  </div>
                </div>
              </div>
            )
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>
              Enable "Safe Ambulance Route" in the sidebar to compute real-time dry-corridor evacuation.
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: PYSEWER ARCHITECTURE INSPECTOR ────────────── */}
      {activeTab === 'pysewer' && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 330, overflowY: 'auto' }}>
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(168, 85, 247, 0.12)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#d8b4fe' }}>
                PySewer Gravity Topology
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: pysewerStatus?.pysewer_installed ? '#10b981' : 'rgba(168, 85, 247, 0.4)',
                  color: 'white',
                }}
              >
                {pysewerStatus?.pysewer_installed ? 'NATIVE PYSEWER' : 'EMBEDDED SYNTHESIZER'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#cbd5e1', lineHeight: 1.3 }}>
              Automated sewer layout generation using OpenStreetMap street centerlines & DEM elevation gravity slopes.
            </div>
          </div>

          <div
            style={{
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 8,
              padding: 8,
              fontSize: 10,
              color: '#94a3b8',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '4px 8px',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>Standard:</span> CPHEEO (MoHUA)
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Min Slope:</span> S ≥ 0.002
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Cleansing Vel:</span> v ≥ 0.6 m/s
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Outfall:</span> Minto Bridge (210.5m)
            </div>
          </div>

          <button
            type="button"
            onClick={loadPysewer}
            disabled={pysewerLoading}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: 'rgba(168, 85, 247, 0.25)',
              border: '1px solid rgba(168, 85, 247, 0.5)',
              color: '#f3e8ff',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {pysewerLoading ? '⏳ Synthesizing...' : '⚡ Re-run PySewer Pipe Synthesis'}
          </button>

          {pysewerData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
                <span>Synthesized Pipes: {pysewerData.total_pipes}</span>
                <span style={{ color: '#c084fc' }}>{(pysewerData.total_length_m / 1000).toFixed(1)} km network</span>
              </div>
              <div
                style={{
                  maxHeight: 120,
                  overflowY: 'auto',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.2)',
                }}
              >
                <table style={{ width: '100%', fontSize: 9, textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '3px 6px' }}>Link</th>
                      <th style={{ padding: '3px 6px' }}>Dia</th>
                      <th style={{ padding: '3px 6px' }}>Slope</th>
                      <th style={{ padding: '3px 6px' }}>Velocity</th>
                      <th style={{ padding: '3px 6px' }}>Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pysewerData.pipes.slice(0, 15).map((pipe, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', color: '#cbd5e1' }}>
                        <td style={{ padding: '3px 6px', maxWidth: 85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${pipe.from_name || pipe.from_node} → ${pipe.to_name || pipe.to_node}`}>
                          {pipe.from_name ? pipe.from_name.replace('Connaught Place', 'CP').replace('Road', 'Rd') : pipe.from_node} → {pipe.to_name ? pipe.to_name.replace('Connaught Place', 'CP').replace('Road', 'Rd') : pipe.to_node}
                        </td>
                        <td style={{ padding: '3px 6px', color: '#38bdf8', fontWeight: 700 }}>
                          {pipe.diameter_mm}mm
                        </td>
                        <td style={{ padding: '3px 6px' }}>{pipe.slope_pct}%</td>
                        <td style={{ padding: '3px 6px', color: pipe.meets_cleansing_vel ? '#34d399' : '#f87171' }}>
                          {pipe.velocity_ms}m/s
                        </td>
                        <td style={{ padding: '3px 6px', color: '#c084fc', fontWeight: 700 }}>
                          {pipe.capacity_m3s}m³/s
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </div>
      )}

      {/* ─── Bottom Footer Status ──────────────────────────────── */}
      <div
        style={{
          padding: '6px 12px',
          background: 'rgba(0,0,0,0.3)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10,
          color: '#64748b',
        }}
      >
        <span>Minto Bridge Hydraulic Zone</span>
        <span style={{ color: isMoved ? '#38bdf8' : '#64748b' }}>
          {isMoved ? '📌 Position Custom' : '⠿ Drag grip to move'}
        </span>
      </div>
    </div>
  );
}
