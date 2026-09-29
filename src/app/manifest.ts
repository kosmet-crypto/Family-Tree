import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: "Roots & Branches — Породично стабло",
    short_name: "Стабло",
    description: "Направите, истражите и сачувајте породично стабло.",
    lang: "sr",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "any",
    background_color: "#f7f4ee",
    theme_color: "#2f6b4f",
    categories: ["lifestyle", "social", "productivity"],
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
