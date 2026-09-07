/**
 * Agastya — StatCard Component
 * Animated glassmorphic KPI card with severity-based glow, trend indicator,
 * and smooth value transitions for the dashboard header and sidebar.
 */

import { useEffect, useRef } from 'react';

export type Severity = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'info';

interface StatCardProps {
  icon: string;
  label: string;
  subLabel?: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  severity?: Severity;
  /** If true, animates numeric value counting up on mount/change */
  animate?: boolean;
  compact?: boolean;
}

function severityGlow(s: Severity): string {
  switch (s) {
    case 'critical': return '0 0 18px rgba(239,68,68,0.5), inset 0 0 0 1px rgba(239,68,68,0.4)';
    case 'high':     return '0 0 18px rgba(249,115,22,0.4), inset 0 0 0 1px rgba(249,115,22,0.35)';
    case 'medium':   return '0 0 14px rgba(245,158,11,0.35), inset 0 0 0 1px rgba(245,158,11,0.3)';
    case 'low':      return '0 0 14px rgba(6,182,212,0.3), inset 0 0 0 1px rgba(6,182,212,0.25)';
    case 'safe':     return '0 0 14px rgba(16,185,129,0.3), inset 0 0 0 1px rgba(16,185,129,0.25)';
    default:         return '0 0 14px rgba(59,130,246,0.25), inset 0 0 0 1px rgba(59,130,246,0.2)';
  }
}

function severityColor(s: Severity): string {
  switch (s) {
    case 'critical': return '#ef4444';
    case 'high':     return '#f97316';
    case 'medium':   return '#f59e0b';
    case 'low':      return '#06b6d4';
    case 'safe':     return '#10b981';
    default:         return '#38bdf8';
  }
}

function trendArrow(trend?: 'up' | 'down' | 'stable', severity?: Severity) {
  if (!trend || trend === 'stable') return null;
  const color = trend === 'up'
    ? (severity === 'safe' || severity === 'low' ? '#10b981' : '#ef4444')
    : (severity === 'safe' || severity === 'low' ? '#ef4444' : '#10b981');
  return (
    <span style={{ fontSize: 11, color, fontWeight: 800, marginLeft: 3 }}>
      {trend === 'up' ? '↑' : '↓'}
    </span>
  );
}

export default function StatCard({
  icon,
  label,
  subLabel,
  value,
  unit,
  trend,
  severity = 'info',
  compact = false,
}: StatCardProps) {
  const valColor = severityColor(severity);
  const boxShadow = severityGlow(severity);
  const prevVal = useRef(value);
  const valRef = useRef<HTMLSpanElement>(null);

  // Flash animation on value change
  useEffect(() => {
    if (prevVal.current !== value && valRef.current) {
      valRef.current.animate(
        [{ opacity: 0.3, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 280, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      );
    }
    prevVal.current = value;
  }, [value]);

  return (
    <div
      style={{
        background: 'rgba(15,23,42,0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: compact ? 8 : 12,
        padding: compact ? '8px 10px' : '10px 12px',
        boxShadow,
        border: `1px solid ${valColor}22`,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        minWidth: 0,
        transition: 'box-shadow 0.4s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 2,
        background: `linear-gradient(90deg, ${valColor}00 0%, ${valColor}cc 50%, ${valColor}00 100%)`,
        borderRadius: '12px 12px 0 0',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: compact ? 12 : 14 }}>{icon}</span>
          <span style={{ fontSize: compact ? 9 : 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </span>
        </div>
        {trendArrow(trend, severity)}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span
          ref={valRef}
          style={{
            fontSize: compact ? 18 : 22,
            fontWeight: 900,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '-0.04em',
            color: valColor,
            lineHeight: 1,
          }}
        >
          {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}
        </span>
        {unit && (
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{unit}</span>
        )}
      </div>

      {subLabel && (
        <span style={{ fontSize: 9.5, color: '#475569', fontWeight: 500 }}>{subLabel}</span>
      )}
    </div>
  );
}
