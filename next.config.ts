import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The headless browser the render_claude engine uses ships its own
  // binaries; bundling them breaks the unpack, so they stay external.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
