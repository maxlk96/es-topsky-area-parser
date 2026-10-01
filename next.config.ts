import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Cursor / proxy hosts to load Next.js HMR and assets in dev
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.cursor.com", "*.cursor.sh"],
};

export default nextConfig;
