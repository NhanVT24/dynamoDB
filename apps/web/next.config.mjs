import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import("next").NextConfig} */
const nextConfig = (phase) => {
  const apiProxyTarget = (
    process.env.NEXT_DEV_API_PROXY_TARGET ??
    process.env.API_PROXY_TARGET ??
    "http://localhost:4000"
  ).replace(/\/+$/, "");

  return {
    output: "export",
    trailingSlash: true,
    async rewrites() {
      if (phase !== PHASE_DEVELOPMENT_SERVER) {
        return [];
      }

      return [
        {
          source: "/api/lambda-proxy/:path*",
          destination: `${apiProxyTarget}/:path*`
        },
        {
          source: "/api/:path*",
          destination: `${apiProxyTarget}/api/:path*`
        },
        {
          source: "/store/products/:slug",
          destination: "/store/products/detail?slug=:slug"
        }
      ];
    }
  };
};

export default nextConfig;
