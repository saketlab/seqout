import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 blocks cross-origin requests to /_next/* dev resources
  // (HMR, source maps, dev assets) by default. When the dev server is
  // accessed via a non-localhost address — Tailscale, LAN IPs, etc. —
  // this prevents the page from hydrating and breaks all interactivity.
  // Allowlist the hosts/IPs we actually use during development.
  allowedDevOrigins: [
    "100.81.232.33", // tailscale
    "10.195.102.16", // lan
    "localhost",
  ],
  async rewrites() {
    // Proxy to localhost:8000 during local development
    // In production, /api routes are handled by the deployed backend
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:8000/:path*",
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
