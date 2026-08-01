import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The System Map reads docs/WORKFLOWS.md at request time (readFileSync). Vercel
  // traces only imported files into a route's serverless bundle, so explicitly
  // include the registry for that route — otherwise it's absent in production and
  // the map falls back to empty.
  outputFileTracingIncludes: {
    "/management/system-map": ["./docs/WORKFLOWS.md"],
  },
};

export default nextConfig;
