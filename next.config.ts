import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Smaller production image for Docker / Proxmox (see Dockerfile).
  output: "standalone",
  // Allow Cursor / proxy hosts to load Next.js HMR and assets in dev
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.cursor.com",
    "*.cursor.sh",
    "*.trycloudflare.com",
  ],
};

export default nextConfig;
