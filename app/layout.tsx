import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: { default: "CanopyOS | Clements", template: "%s · CanopyOS" },
  description:
    "The operating platform for Clements Pest Control — inventory, fleet, people, and management in one place.",
  applicationName: "CanopyOS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CanopyOS",
  },
  icons: {
    icon: "/icons/canopyos-favicon.png",
    apple: "/icons/canopyos-apple.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B3D20",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
