import type { NextConfig } from 'next'

/**
 * The renderer is a fully static, client-only export loaded from file:// in the
 * packaged app. There is no Node server at runtime, so SSR, API routes and image
 * optimization are all unavailable by design — every byte of data reaches the UI
 * through the IPC contract in shared/ipc.ts.
 */
const config: NextConfig = {
  output: 'export',
  distDir: '.next',
  // file:// has no directory-index resolution, so emit page/index.html.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  typedRoutes: true,
}

export default config
