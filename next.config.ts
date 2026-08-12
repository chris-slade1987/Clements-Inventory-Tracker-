import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-leaflet v5 + @react-leaflet/core ship as ESM; transpile them (and
  // leaflet) so the Fleet live map bundles and runs correctly in the production
  // App-Router build instead of failing to initialize in the browser.
  transpilePackages: ["react-leaflet", "@react-leaflet/core", "leaflet"],
  // The System Map reads docs/WORKFLOWS.md at request time (readFileSync). Vercel
  // traces only imported files into a route's serverless bundle, so explicitly
  // include the registry for that route — otherwise it's absent in production and
  // the map falls back to empty.
  outputFileTracingIncludes: {
    "/management/system-map": ["./docs/WORKFLOWS.md"],
  },
};

export default nextConfig;
