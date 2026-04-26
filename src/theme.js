import { createContext, useContext } from "react";

// Monochrome glass theme (iOS-26 feel) — warm bone/ink family, frosted surfaces.
// Legacy keys (bg/card/text/btnPrimary/...) stay populated so untouched inline styles
// keep working while we roll out glass primitives everywhere.
export const THEMES = {
  light: {
    mode: "light",
    // Glass tokens
    bg1: "#F6F3EE", bg2: "#EAE4DA",
    bgBlob: "#FFFFFF", bgBlob2: "#D9D2C3",
    ink: "#1A1714", inkSoft: "#4A453E", inkMuted: "#7C766C", inkFaint: "#A9A196",
    inkGhost: "rgba(26,23,20,0.14)",
    glassFill: "rgba(255,253,249,0.58)",
    glassFillSolid: "#FBF8F1",
    glassFillStrong: "rgba(255,253,249,0.82)",
    glassBorder: "rgba(255,255,255,0.65)",
    glassBorderInk: "rgba(26,23,20,0.06)",
    glassShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 34px rgba(60,40,20,0.08), 0 2px 6px rgba(60,40,20,0.04)",
    hair: "rgba(26,23,20,0.08)",
    hairStrong: "rgba(26,23,20,0.16)",
    accentInk: "#1A1714", accentOnInk: "#FBF8F1",
    focus: "rgba(26,23,20,0.22)",

    // Legacy compatibility (keep inline styles that read these working)
    bg: "#F6F3EE", card: "rgba(255,253,249,0.78)",
    cardShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 34px rgba(60,40,20,0.08), 0 2px 6px rgba(60,40,20,0.04)",
    text: "#1A1714", textMuted: "#7C766C", textFaint: "#A9A196", textLabel: "#7C766C",
    border: "rgba(26,23,20,0.16)", borderLight: "rgba(26,23,20,0.08)",
    surface: "rgba(255,253,249,0.58)", surfaceAlt: "rgba(255,253,249,0.4)",
    cell: "rgba(255,253,249,0.62)", cellWall: "rgba(26,23,20,0.06)", grid: "rgba(26,23,20,0.12)",
    btnPrimary: "#1A1714", btnPrimaryText: "#FBF8F1",
    toast: "rgba(26,23,20,0.92)", toastText: "#FBF8F1",
  },
  dark: {
    mode: "dark",
    bg1: "#1B1915", bg2: "#0F0E0B",
    bgBlob: "#3B332A", bgBlob2: "#0A0908",
    ink: "#F5F0E6", inkSoft: "#C3BCAD", inkMuted: "#8A8275", inkFaint: "#5B5449",
    inkGhost: "rgba(245,240,230,0.14)",
    glassFill: "rgba(60,54,46,0.44)",
    glassFillSolid: "#24211C",
    glassFillStrong: "rgba(60,54,46,0.68)",
    glassBorder: "rgba(255,250,240,0.1)",
    glassBorderInk: "rgba(0,0,0,0.4)",
    glassShadow: "0 1px 0 rgba(255,250,240,0.08) inset, 0 14px 40px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)",
    hair: "rgba(245,240,230,0.1)",
    hairStrong: "rgba(245,240,230,0.2)",
    accentInk: "#F5F0E6", accentOnInk: "#1B1915",
    focus: "rgba(245,240,230,0.3)",

    bg: "#1B1915", card: "rgba(60,54,46,0.56)",
    cardShadow: "0 1px 0 rgba(255,250,240,0.08) inset, 0 14px 40px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)",
    text: "#F5F0E6", textMuted: "#8A8275", textFaint: "#5B5449", textLabel: "#8A8275",
    border: "rgba(245,240,230,0.2)", borderLight: "rgba(245,240,230,0.1)",
    surface: "rgba(60,54,46,0.44)", surfaceAlt: "rgba(60,54,46,0.3)",
    cell: "rgba(60,54,46,0.5)", cellWall: "rgba(245,240,230,0.08)", grid: "rgba(245,240,230,0.14)",
    btnPrimary: "#F5F0E6", btnPrimaryText: "#1B1915",
    toast: "rgba(245,240,230,0.92)", toastText: "#1B1915",
  },
};

export const ThemeCtx = createContext(THEMES.light);
export function useTheme() { return useContext(ThemeCtx); }

export function themeVars(t) {
  return Object.entries(t).map(([k, v]) => `--${k}: ${v};`).join(" ");
}
