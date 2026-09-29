import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the UI as static files (GitHub Pages, Capacitor bundle).
// The API routes are left out of that build (scripts/build-static.mjs) and are served by the
// full Next.js deployment configured in NEXT_PUBLIC_API_BASE.
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // typecheck runs separately in CI; tests import the API routes that this build leaves out
  ...(staticExport ? { output: "export", trailingSlash: true, images: { unoptimized: true }, typescript: { ignoreBuildErrors: true } } : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
