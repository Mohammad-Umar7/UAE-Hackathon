import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // the floating dev-tools badge covers the side navigation in recorded demos
  devIndicators: false,
  turbopack: {
    // the repository root (a stray lockfile in the user's home folder must not be picked as the workspace root)
    root: path.resolve(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
