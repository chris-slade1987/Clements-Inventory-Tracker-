import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CanopyOS",
    short_name: "CanopyOS",
    description:
      "Inventory and management reporting portal for Clements Pest Control.",
    // "/" resolves to each role's real home (app/page.tsx redirects via homePath),
    // so the installed PWA never dumps a non-admin on /dashboard (which the guard
    // then redirects away from).
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B3D20",
    theme_color: "#0B3D20",
    icons: [
      {
        src: "/icons/canopyos-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/canopyos-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/canopyos-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
