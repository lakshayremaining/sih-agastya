/**
 * Agastya — RainSlider Component
 * Animated rain intensity range slider with:
 * - Dynamic gradient track (green → amber → red)
 * - Floating chip above thumb showing current value + weather emoji
 * - IMD rainfall classification label
 * - Animated rain-drop bounce on thumb during active drag
 */

import { useRef, useState } from 'react';

interface RainSliderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

function getWeatherEmoji(mm: number): string {
  if (mm === 0) return '☀️';
  if (mm < 8) return '🌦️';
  if (mm < 15) return '🌧️';
  if (mm < 35) return '🌧️';
  if (mm < 65) return '⛈️';
  return '🌊';
}

function getRainLabel(mm: number): string {
  if (mm === 0) return 'Dry / No Rain';
  if (mm < 2.5) return 'Very Light Drizzle';
  if (mm < 8) return 'Light Rain';
  if (mm < 15) return 'Moderate Rain';
  if (mm < 35) return 'Heavy Rain';
  if (mm < 65) return 'Very Heavy / Extreme Rain';
  return '🚨 Cloudburst / Flash Flood Risk';
}

function getTrackGradient(mm: number): string {
  if (mm <= 8) return 'linear-gradient(90deg, #10b981, #06b6d4)';
  if (mm <= 15) return 'linear-gradient(90deg, #06b6d4, #f59e0b)';
  if (mm <= 35) return 'linear-gradient(90deg, #f59e0b, #f97316)';
  return 'linear-gradient(90deg, #f97316, #ef4444)';
}

function getLabelColor(mm: number): string {
  if (mm === 0) return '#10b981';
  if (mm < 15) return '#06b6d4';
  if (mm < 35) return '#f59e0b';
  if (mm < 65) return '#f97316';
  return '#ef4444';
}

export default function RainSlider({ value, onChange, min = 0, max = 100, label = 'Rainfall Intensity' }: RainSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pct = ((value - min) / (max - min)) * 100;
  const thumbColor = getLabelColor(value);

  return (
    <div style={{ padding: '0 16px 14px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label}
          </div>
          <div style={{ fontSize: 10.5, color: getLabelColor(value), fontWeight: 700, marginTop: 1 }}>
            {getWeatherEmoji(value)} {getRainLabel(value)}
          </div>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 2,
          background: `${thumbColor}18`,
          border: `1px solid ${thumbColor}55`,
          borderRadius: 8,
          padding: '4px 10px',
          transition: 'all 0.2s',
        }}>
          <span style={{
            fontSize: 24,
            fontWeight: 900,
            fontFamily: "'JetBrains Mono', monospace",
            color: thumbColor,
            lineHeight: 1,
            transition: 'color 0.3s',
          }}>
            {value}
          </span>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>mm/hr</span>
        </div>
      </div>

      {/* Slider wrapper */}
      <div style={{ position: 'relative', paddingTop: 18 }}>
        {/* Floating chip above thumb */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `clamp(14px, calc(${pct}% - 6px), calc(100% - 28px))`,
            transform: 'translateX(-50%)',
            background: thumbColor,
            color: 'white',
            fontSize: 9,
            fontWeight: 800,
            padding: '2px 5px',
            borderRadius: 5,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: `0 2px 8px ${thumbColor}55`,
            transition: 'left 0.05s linear, background 0.3s',
            animation: isDragging ? 'rain-bounce 0.4s ease infinite alternate' : 'none',
          }}
        >
          {getWeatherEmoji(value)} {value}
        </div>

        {/* Track background */}
        <div style={{
          position: 'absolute',
          top: 18 + 10,
          left: 0,
          right: 0,
          height: 6,
          borderRadius: 3,
          background: 'rgba(255,255,255,0.08)',
        }} />

        {/* Filled track */}
        <div style={{
          position: 'absolute',
          top: 18 + 10,
          left: 0,
          width: `${pct}%`,
          height: 6,
          borderRadius: 3,
          background: getTrackGradient(value),
          transition: 'width 0.05s linear, background 0.3s',
          boxShadow: `0 0 8px ${thumbColor}66`,
        }} />

        {/* Range input */}
        <input
          ref={inputRef}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          style={{
            WebkitAppearance: 'none',
            appearance: 'none',
            width: '100%',
            height: 26,
            background: 'transparent',
            outline: 'none',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 2,
          }}
        />
      </div>

      {/* Tick marks */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {[0, 25, 50, 75, 100].map(tick => (
          <span key={tick} style={{ fontSize: 9, color: '#334155', fontFamily: "'JetBrains Mono', monospace" }}>
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
