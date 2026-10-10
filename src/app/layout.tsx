import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NativeBridge } from "@/components/app/native-bridge";
import { ServiceWorker } from "@/components/app/service-worker";
import { THEME_BOOT } from "@/client/theme";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Roots & Branches — Породично стабло",
  description: "Направите, истражите и сачувајте породично стабло.",
  applicationName: "Roots & Branches",
  appleWebApp: { capable: true, title: "Стабло", statusBarStyle: "default" },
  icons: {
    icon: [{ url: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" }],
    apple: [{ url: `${base}/icons/apple-touch-icon.png`, sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#17121f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sr" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body className="font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
        <NativeBridge />
      </body>
    </html>
  );
}
