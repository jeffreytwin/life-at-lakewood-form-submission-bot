import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The headless browser the render_claude engine uses ships its own
  // binaries; bundling them breaks the unpack, so they stay external.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // External is not enough on its own: those binaries are brotli archives,
  // not code, so nothing imports them and the tracer leaves them behind —
  // the function then starts and finds no browser to run (Jeff,
  // 2026-09-22). They are named here for the two routes that launch one,
  // and nowhere else: they weigh 68MB. The run route is matched with a
  // wildcard rather than written out, because these keys are globs and a
  // dynamic segment's brackets read as a character class — "[id]" matches
  // the letter i or d, never the segment.
  outputFileTracingIncludes: {
    "/api/internal/floorplans/connections/*/run": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/cron/floorplan-nightly": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
