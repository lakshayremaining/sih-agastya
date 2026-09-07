/**
 * Agastya — Toast Notification System
 * Floating toasts in top-center of viewport for real-time feedback:
 * - Simulation updated / Route found / Route blocked / Error
 * Toasts auto-dismiss after 3s with smooth slide-in/out animation.
 */

import { useEffect, useRef } from 'react';

export type ToastLevel = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  level: ToastLevel;
  icon?: string;
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function toastColors(level: ToastLevel) {
  switch (level) {
    case 'success': return { bg: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,0.5)', text: '#34d399', icon: '✅' };
    case 'warning': return { bg: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.5)', text: '#fbbf24', icon: '⚠️' };
    case 'error':   return { bg: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.5)',  text: '#f87171', icon: '🚨' };
    default:        return { bg: 'rgba(59,130,246,0.18)', border: 'rgba(59,130,246,0.5)', text: '#60a5fa', icon: 'ℹ️' };
  }
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const c = toastColors(toast.level);
  const timerRef = useRef<number | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      if (elRef.current) {
        elRef.current.animate(
          [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-12px) scale(0.95)' }],
          { duration: 220, easing: 'ease-in', fill: 'forwards' }
        ).onfinish = () => onDismiss();
      } else {
        onDismiss();
      }
    }, 3000);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [onDismiss]);

  return (
    <div
      ref={elRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        padding: '8px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        animation: 'toastIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        cursor: 'pointer',
        minWidth: 220,
        maxWidth: 380,
        pointerEvents: 'auto',
      }}
      onClick={onDismiss}
      title="Click to dismiss"
    >
      <span style={{ fontSize: 15, flexShrink: 0 }}>{toast.icon || c.icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: c.text, flex: 1, lineHeight: 1.3 }}>
        {toast.message}
      </span>
      <span style={{ fontSize: 14, color: c.border, flexShrink: 0, opacity: 0.6 }}>×</span>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        alignItems: 'center',
      }}
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

/** Hook to manage toast list with add/dismiss */
import { useState, useCallback } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, level: ToastLevel = 'info', icon?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(prev => [...prev.slice(-4), { id, message, level, icon }]); // max 5
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
