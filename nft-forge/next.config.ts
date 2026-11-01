import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "archiver"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
