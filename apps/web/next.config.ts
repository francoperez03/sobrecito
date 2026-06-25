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

  // Routes were renamed employer→pay, employee→receive, auditor→audit. Keep the
  // old URLs working (bookmarks, the demo script) via temporary redirects.
  // Temporary (307) on purpose: avoids browsers hard-caching the redirect while
  // the surface naming is still settling.
  async redirects() {
    return [
      { source: '/employer', destination: '/pay', permanent: false },
      { source: '/employee', destination: '/receive', permanent: false },
      { source: '/employee/:path*', destination: '/receive/:path*', permanent: false },
      { source: '/auditor', destination: '/audit', permanent: false },
    ]
  },
}

export default nextConfig
