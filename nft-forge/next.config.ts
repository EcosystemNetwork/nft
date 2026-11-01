import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "archiver"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  // Project data is runtime state under ./data (or NFT_FORGE_DATA), never part of the build output.
  outputFileTracingExcludes: { "*": ["./data/**/*"] },
};

export default nextConfig;
