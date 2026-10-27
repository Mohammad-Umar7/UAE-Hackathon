import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SKYPACT_STATIC=1 exports plain files to out/ (the app runs entirely in the browser): what is hosted on Vercel
  ...(process.env.SKYPACT_STATIC ? { output: "export" as const } : {}),
  reactStrictMode: false,
  // the floating dev-tools badge covers the side navigation in recorded demos
  devIndicators: false,
  turbopack: {
    // this app's own folder: a stray lockfile in the user's home folder must not be picked as the workspace root, and
    // Vercel resolves the build output from here (the repository root doubled the path to .next)
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
