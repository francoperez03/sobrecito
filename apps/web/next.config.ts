import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Turbopack is default in Next.js 16 — no config needed
  // cacheComponents: false (default — opt in when needed)

  // Required for witness_bg.wasm (wasmer-js SharedArrayBuffer support)
  // The witness calculator uses Atomics + shared memory for signal I/O.
  // Without cross-origin isolation, SharedArrayBuffer is disabled in browsers
  // and witness computation silently corrupts field element writes.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ]
  },
}

export default nextConfig
