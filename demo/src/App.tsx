import React, { useState } from 'react';
import { TgImg, TgImgProvider } from '@tgimg/react';
import type { TgImgManifest } from '@tgimg/react';
import manifest from './tgimg.manifest.json';

// Cast the imported JSON to our manifest type.
const typedManifest = manifest as unknown as TgImgManifest;

// Generate card keys for demonstration.
const cardKeys = Object.keys(typedManifest.assets).filter((k) =>
  k.startsWith('demo/card'),
);

// Repeat cards to simulate a real feed.
const feedCards: string[] = [];
for (let i = 0; i < 8; i++) {
  feedCards.push(...cardKeys);
}

export function App() {
  const [mode, setMode] = useState<'tgimg' | 'native'>('tgimg');

  return (
    <TgImgProvider manifest={typedManifest}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px' }}>
        {/* Header */}
        <header style={{ marginBottom: 24, textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: 8,
            }}
          >
            tgimg demo
          </h1>
          <p style={{ color: '#888', fontSize: 14 }}>
            Image pipeline for Telegram Mini Apps
          </p>
        </header>

        {/* Mode toggle */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 20,
            justifyContent: 'center',
          }}
        >
          <button
            onClick={() => setMode('tgimg')}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              background: mode === 'tgimg' ? '#6366f1' : '#1a1a2e',
              color: mode === 'tgimg' ? '#fff' : '#888',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.2s',
            }}
          >
            With TgImg
          </button>
          <button
            onClick={() => setMode('native')}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              background: mode === 'native' ? '#ef4444' : '#1a1a2e',
              color: mode === 'native' ? '#fff' : '#888',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.2s',
            }}
          >
            Native &lt;img&gt;
          </button>
        </div>

        {/* Stats bar */}
        <div
          style={{
            background: '#111827',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8,
            fontSize: 12,
          }}
        >
          <Stat label="Assets" value={String(manifest.stats.total_assets)} />
          <Stat
            label="Input"
            value={formatBytes(manifest.stats.total_input_bytes)}
          />
          <Stat
            label="Output"
            value={formatBytes(manifest.stats.total_output_bytes)}
          />
        </div>

        {/* Banner */}
        <div style={{ marginBottom: 20 }}>
          {mode === 'tgimg' ? (
            <TgImg
              src="demo/banner"
              alt="Demo banner"
              fit="cover"
              radius={12}
              priority
            />
          ) : (
            <img
              src="https://picsum.photos/id/10/1280/720"
              alt="Demo banner"
              style={{
                width: '100%',
                borderRadius: 12,
                display: 'block',
              }}
            />
          )}
        </div>

        {/* Card grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}
        >
          {feedCards.map((key, i) => (
            <div key={`${key}-${i}`}>
              {mode === 'tgimg' ? (
                <TgImg
                  src={key}
                  alt={`Card ${i + 1}`}
                  fit="cover"
                  radius={8}
                />
              ) : (
                <NativeCard index={i} assetKey={key} />
              )}
            </div>
          ))}
        </div>

        {/* Info */}
        <div
          style={{
            marginTop: 32,
            padding: 16,
            background: '#111827',
            borderRadius: 12,
            fontSize: 13,
            lineHeight: 1.6,
            color: '#9ca3af',
          }}
        >
          <h3 style={{ color: '#e0e0e0', marginBottom: 8, fontSize: 15 }}>
            How it works
          </h3>
          <ul style={{ paddingLeft: 20 }}>
            <li>
              <strong>TgImg mode:</strong> Instant thumbhash placeholder →
              smooth fade-in → optimal variant selection (format + size + DPR)
            </li>
            <li>
              <strong>Native mode:</strong> Raw &lt;img&gt; with full-size URL →
              visible blank/blink while loading
            </li>
            <li>
              Sizes: {formatBytes(manifest.stats.total_input_bytes)} input →{' '}
              {formatBytes(manifest.stats.total_output_bytes)} output (
              {Math.round(
                (manifest.stats.total_output_bytes /
                  manifest.stats.total_input_bytes) *
                  100,
              )}
              %)
            </li>
          </ul>
        </div>
      </div>
    </TgImgProvider>
  );
}

function NativeCard({
  index,
  assetKey,
}: {
  index: number;
  assetKey: string;
}) {
  // Extract picsum ID from the manifest path.
  const asset = typedManifest.assets[assetKey];
  const variant = asset?.variants[asset.variants.length - 1];
  const src = variant
    ? `${typedManifest.base_path}${variant.path}`
    : `https://picsum.photos/640/480?random=${index}`;

  return (
    <img
      src={src}
      alt={`Card ${index + 1}`}
      style={{
        width: '100%',
        aspectRatio: '4/3',
        objectFit: 'cover',
        borderRadius: 8,
        display: 'block',
      }}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#6366f1', fontWeight: 700, fontSize: 16 }}>
        {value}
      </div>
      <div style={{ color: '#6b7280' }}>{label}</div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MB`;
  if (b >= 1 << 10) return `${(b / (1 << 10)).toFixed(1)} KB`;
  return `${b} B`;
}
