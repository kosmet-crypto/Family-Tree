// Colour theme: stored on the device only, applied as <html data-theme="…"> before first paint.

export const THEMES = [
  { id: "bubblegum", label: "Bubblegum", swatch: ["#7c4dff", "#ff6f91"] },
  { id: "ocean", label: "Ocean", swatch: ["#0b7fc7", "#12b8a6"] },
  { id: "forest", label: "Forest", swatch: ["#2f8f55", "#e8883a"] },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
const KEY = "rb-theme";

export function getTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch { /* private mode */ }
  return "bubblegum";
}

export function setTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(KEY, id); } catch { /* not persisted */ }
}

/** Inline script for <head>: no flash of the default theme. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${KEY}");if(t)document.documentElement.dataset.theme=t}catch(e){}`;
