import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PAPERPILOT_NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
