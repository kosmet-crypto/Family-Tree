import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NativeBridge } from "@/components/app/native-bridge";
import { ServiceWorker } from "@/components/app/service-worker";
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
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#161412" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sr">
      <body className="font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
        <NativeBridge />
      </body>
    </html>
  );
}
