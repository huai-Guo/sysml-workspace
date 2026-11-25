import type { CanvasThemeId } from "./types";

export interface ThemeStyles {
  name: string;
  canvasBg: string;
  gridColor: string;
  node: {
    fill: string;
    stroke: string;
    strokeWidth: number;
    headerFill: string;
    textPrimary: string;
    textSecondary: string;
    dividerColor: string;
    packageTabFill: string;
  };
  port: {
    fill: string;
    stroke: string;
    textColor: string;
  };
  edge: {
    connectionStroke: string;
    flowStroke: string;
    satisfyStroke: string;
    specializationStroke: string;
    transitionStroke: string;
    strokeWidth: number;
    textColor: string;
  };
  isIso: boolean;
}

export const THEMES: Record<"cad-blueprint" | "syson-clean" | "iso-drafting", ThemeStyles> = {
  "cad-blueprint": {
    name: "CAD Dark Blueprint",
    canvasBg: "#0d1219",
    gridColor: "#1e293b",
    node: {
      fill: "#131b26",
      stroke: "#38bdf8",
      strokeWidth: 1.5,
      headerFill: "#1a2434",
      textPrimary: "#f1f5f9",
      textSecondary: "#94a3b8",
      dividerColor: "#273549",
      packageTabFill: "#1e2c40",
    },
    port: {
      fill: "#0284c7",
      stroke: "#38bdf8",
      textColor: "#7dd3fc",
    },
    edge: {
      connectionStroke: "#38bdf8",
      flowStroke: "#f59e0b",
      satisfyStroke: "#ec4899",
      specializationStroke: "#94a3b8",
      transitionStroke: "#34d399",
      strokeWidth: 1.5,
      textColor: "#e2e8f0",
    },
    isIso: false,
  },
  "syson-clean": {
    name: "SysON Clean Light",
    canvasBg: "#f8fafc",
    gridColor: "#cbd5e1",
    node: {
      fill: "#ffffff",
      stroke: "#334155",
      strokeWidth: 1.5,
      headerFill: "#f1f5f9",
      textPrimary: "#0f172a",
      textSecondary: "#64748b",
      dividerColor: "#e2e8f0",
      packageTabFill: "#e2e8f0",
    },
    port: {
      fill: "#3b82f6",
      stroke: "#1d4ed8",
      textColor: "#1e40af",
    },
    edge: {
      connectionStroke: "#2563eb",
      flowStroke: "#d97706",
      satisfyStroke: "#db2777",
      specializationStroke: "#475569",
      transitionStroke: "#059669",
      strokeWidth: 1.5,
      textColor: "#334155",
    },
    isIso: false,
  },
  "iso-drafting": {
    name: "Paper Clean B&W",
    canvasBg: "#ffffff",
    gridColor: "#f1f5f9",
    node: {
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 1.5,
      headerFill: "#f8fafc",
      textPrimary: "#000000",
      textSecondary: "#222222",
      dividerColor: "#000000",
      packageTabFill: "#f1f5f9",
    },
    port: {
      fill: "#000000",
      stroke: "#000000",
      textColor: "#000000",
    },
    edge: {
      connectionStroke: "#000000",
      flowStroke: "#000000",
      satisfyStroke: "#000000",
      specializationStroke: "#333333",
      transitionStroke: "#000000",
      strokeWidth: 1.2,
      textColor: "#000000",
    },
    isIso: false,
  },
};

export function resolveTheme(themeId: CanvasThemeId): ThemeStyles {
  if (themeId === "auto") {
    if (typeof document !== "undefined") {
      const isDark =
        document.body?.classList.contains("dark") ||
        document.documentElement?.getAttribute("data-theme") === "dark" ||
        (typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches);
      return isDark ? THEMES["cad-blueprint"] : THEMES["syson-clean"];
    }
    return THEMES["cad-blueprint"];
  }
  return THEMES[themeId] || THEMES["cad-blueprint"];
}
