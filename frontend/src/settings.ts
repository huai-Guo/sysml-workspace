import { el, optEl } from "./dom";

export type ThemeType = "codex-dark" | "midnight" | "oled" | "light";
export type FontFamilyType = "jetbrains" | "fira" | "cascadia" | "consolas" | "system";
export type FontSizeType = "12px" | "13px" | "14px" | "15px" | "16px";
export type TabSizeType = "2" | "4";
export type LineWrapType = "on" | "off";

export interface SettingsState {
  theme: ThemeType;
  fontFamily: FontFamilyType;
  fontSize: FontSizeType;
  tabSize: TabSizeType;
  lineWrap: LineWrapType;
}

const STORAGE_KEY = "sysml_workbench_settings";

const DEFAULT_SETTINGS: SettingsState = {
  theme: "codex-dark",
  fontFamily: "jetbrains",
  fontSize: "13px",
  tabSize: "4",
  lineWrap: "on",
};

const FONT_MAP: Record<FontFamilyType, string> = {
  jetbrains: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
  fira: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
  cascadia: "'Cascadia Code', 'Consolas', monospace",
  consolas: "Consolas, 'Courier New', monospace",
  system: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

let currentSettings: SettingsState = { ...DEFAULT_SETTINGS };
let changeListener: ((settings: SettingsState) => void) | undefined;

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  return currentSettings;
}

export function saveSettings(settings: SettingsState) {
  currentSettings = { ...settings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch {
    // ignore
  }
}

export function applySettings(settings: SettingsState) {
  document.documentElement.setAttribute("data-theme", settings.theme);
  const root = document.documentElement;
  root.style.setProperty("--editor-font-family", FONT_MAP[settings.fontFamily] || FONT_MAP.jetbrains);
  root.style.setProperty("--editor-font-size", settings.fontSize || "13px");
  root.style.setProperty("--editor-tab-size", settings.tabSize || "4");

  saveSettings(settings);
  syncSelects(settings);

  if (changeListener) {
    changeListener(settings);
  }
}

function syncSelects(settings: SettingsState) {
  const themeSel = optEl<HTMLSelectElement>("setting-theme");
  if (themeSel) themeSel.value = settings.theme;

  const fontSel = optEl<HTMLSelectElement>("setting-font-family");
  if (fontSel) fontSel.value = settings.fontFamily;

  const sizeSel = optEl<HTMLSelectElement>("setting-font-size");
  if (sizeSel) sizeSel.value = settings.fontSize;

  const tabSel = optEl<HTMLSelectElement>("setting-tab-size");
  if (tabSel) tabSel.value = settings.tabSize;

  const wrapSel = optEl<HTMLSelectElement>("setting-line-wrap");
  if (wrapSel) wrapSel.value = settings.lineWrap;
}

export function initSettings(onChange?: (settings: SettingsState) => void): SettingsState {
  changeListener = onChange;
  const initial = loadSettings();
  applySettings(initial);

  const modal = optEl<HTMLDialogElement>("settings-modal");
  const openBtn = optEl("open-settings");
  const closeBtn = optEl("close-settings");
  const saveBtn = optEl("save-settings");
  const resetBtn = optEl("reset-settings");

  if (openBtn && modal) {
    openBtn.onclick = () => {
      syncSelects(currentSettings);
      modal.showModal();
    };
  }

  if (closeBtn && modal) {
    closeBtn.onclick = () => modal.close();
  }

  if (saveBtn && modal) {
    saveBtn.onclick = () => {
      const updated: SettingsState = {
        theme: (optEl<HTMLSelectElement>("setting-theme")?.value as ThemeType) || "codex-dark",
        fontFamily: (optEl<HTMLSelectElement>("setting-font-family")?.value as FontFamilyType) || "jetbrains",
        fontSize: (optEl<HTMLSelectElement>("setting-font-size")?.value as FontSizeType) || "13px",
        tabSize: (optEl<HTMLSelectElement>("setting-tab-size")?.value as TabSizeType) || "4",
        lineWrap: (optEl<HTMLSelectElement>("setting-line-wrap")?.value as LineWrapType) || "on",
      };
      applySettings(updated);
      modal.close();
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      applySettings({ ...DEFAULT_SETTINGS });
    };
  }

  // Real-time preview on change
  const selects = [
    "setting-theme",
    "setting-font-family",
    "setting-font-size",
    "setting-tab-size",
    "setting-line-wrap",
  ];
  for (const id of selects) {
    const el = optEl<HTMLSelectElement>(id);
    if (el) {
      el.onchange = () => {
        const preview: SettingsState = {
          theme: (optEl<HTMLSelectElement>("setting-theme")?.value as ThemeType) || "codex-dark",
          fontFamily: (optEl<HTMLSelectElement>("setting-font-family")?.value as FontFamilyType) || "jetbrains",
          fontSize: (optEl<HTMLSelectElement>("setting-font-size")?.value as FontSizeType) || "13px",
          tabSize: (optEl<HTMLSelectElement>("setting-tab-size")?.value as TabSizeType) || "4",
          lineWrap: (optEl<HTMLSelectElement>("setting-line-wrap")?.value as LineWrapType) || "on",
        };
        applySettings(preview);
      };
    }
  }

  return currentSettings;
}
