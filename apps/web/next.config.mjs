import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import("next").NextConfig} */
const nextConfig = (phase) => ({
  output: "export",
  trailingSlash: true,
  async rewrites() {
    if (phase !== PHASE_DEVELOPMENT_SERVER) {
      return [];
    }

    return [
      {
        source: "/store/products/:slug",
        destination: "/store/products/detail?slug=:slug"
      }
    ];
  }
});

export default nextConfig;
