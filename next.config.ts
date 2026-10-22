import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdf-parse"],
  outputFileTracingIncludes: {
    "/api/assistant/*": [
      "node_modules/@napi-rs/canvas/**/*",
      "node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "node_modules/pdfjs-dist/**/*",
    ],
    "/api/files": [
      "node_modules/@napi-rs/canvas/**/*",
      "node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "node_modules/pdfjs-dist/**/*",
    ],
    "/api/folders": [
      "node_modules/@napi-rs/canvas/**/*",
      "node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "node_modules/pdfjs-dist/**/*",
    ],
  },
  poweredByHeader: false,
};

export default nextConfig;
