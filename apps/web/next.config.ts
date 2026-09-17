import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ceedo/shared is a workspace package resolved to its TypeScript source
  // (no build step), so Next must transpile it like first-party app code.
  transpilePackages: ["@ceedo/shared"],
};

export default nextConfig;
