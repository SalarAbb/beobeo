import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-tools badge overlaps the sidebar footer.
  devIndicators: false,
  transpilePackages: [
    "@beobeo/core",
    "@beobeo/db",
    "@beobeo/market-data",
    "@beobeo/importers",
    "@beobeo/agent",
  ],
};

export default nextConfig;
