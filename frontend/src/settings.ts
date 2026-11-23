import { optEl } from "./dom";

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
  syncDropupUI(settings);

  if (changeListener) {
    changeListener(settings);
  }
}

function syncDropupUI(settings: SettingsState) {
  // Theme option buttons
  document.querySelectorAll<HTMLButtonElement>('.dropup-opt-btn[data-setting="theme"]').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === settings.theme);
  });

  // Font family select
  const fontSel = optEl<HTMLSelectElement>("dropup-font-family");
  if (fontSel) fontSel.value = settings.fontFamily;

  // Font size buttons
  document.querySelectorAll<HTMLButtonElement>('.dropup-seg-btn[data-setting="fontSize"]').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === settings.fontSize);
  });

  // Line wrap buttons
  document.querySelectorAll<HTMLButtonElement>('.dropup-pill-btn[data-setting="lineWrap"]').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === settings.lineWrap);
  });

  // Tab size buttons
  document.querySelectorAll<HTMLButtonElement>('.dropup-pill-btn[data-setting="tabSize"]').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === settings.tabSize);
  });
}

export function initSettings(onChange?: (settings: SettingsState) => void): SettingsState {
  changeListener = onChange;
  const initial = loadSettings();
  applySettings(initial);

  const dropup = optEl<HTMLElement>("settings-dropup");
  const openBtn = optEl<HTMLButtonElement>("open-settings");
  const userBtn = optEl<HTMLElement>("account-user-btn");
  const resetBtn = optEl<HTMLButtonElement>("reset-settings-dropup");

  const toggleDropup = (e?: Event) => {
    e?.stopPropagation();
    if (!dropup) return;
    const isHidden = dropup.hidden;
    dropup.hidden = !isHidden;
    if (openBtn) {
      openBtn.setAttribute("aria-expanded", isHidden ? "true" : "false");
    }
    if (isHidden) {
      syncDropupUI(currentSettings);
    }
  };

  const closeDropup = () => {
    if (dropup && !dropup.hidden) {
      dropup.hidden = true;
      if (openBtn) openBtn.setAttribute("aria-expanded", "false");
    }
  };

  if (openBtn) openBtn.onclick = toggleDropup;
  if (userBtn) userBtn.onclick = toggleDropup;

  // Close dropup when clicking outside
  document.addEventListener("click", (e) => {
    if (dropup && !dropup.hidden) {
      const target = e.target as Node;
      if (!dropup.contains(target) && !openBtn?.contains(target) && !userBtn?.contains(target)) {
        closeDropup();
      }
    }
  });

  // Close dropup on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dropup && !dropup.hidden) {
      closeDropup();
    }
  });

  // Theme option clicks
  document.querySelectorAll<HTMLButtonElement>('.dropup-opt-btn[data-setting="theme"]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const val = btn.dataset.value as ThemeType;
      if (val) {
        applySettings({ ...currentSettings, theme: val });
      }
    };
  });

  // Font family change
  const fontSel = optEl<HTMLSelectElement>("dropup-font-family");
  if (fontSel) {
    fontSel.onchange = (e) => {
      e.stopPropagation();
      const val = fontSel.value as FontFamilyType;
      if (val) {
        applySettings({ ...currentSettings, fontFamily: val });
      }
    };
  }

  // Font size clicks
  document.querySelectorAll<HTMLButtonElement>('.dropup-seg-btn[data-setting="fontSize"]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const val = btn.dataset.value as FontSizeType;
      if (val) {
        applySettings({ ...currentSettings, fontSize: val });
      }
    };
  });

  // Line wrap clicks
  document.querySelectorAll<HTMLButtonElement>('.dropup-pill-btn[data-setting="lineWrap"]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const val = btn.dataset.value as LineWrapType;
      if (val) {
        applySettings({ ...currentSettings, lineWrap: val });
      }
    };
  });

  // Tab size clicks
  document.querySelectorAll<HTMLButtonElement>('.dropup-pill-btn[data-setting="tabSize"]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const val = btn.dataset.value as TabSizeType;
      if (val) {
        applySettings({ ...currentSettings, tabSize: val });
      }
    };
  });

  // Reset to default
  if (resetBtn) {
    resetBtn.onclick = (e) => {
      e.stopPropagation();
      applySettings({ ...DEFAULT_SETTINGS });
    };
  }

  return currentSettings;
}
