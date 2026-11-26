import type { SysMLViewIR, NodeLayoutPosition } from "../types";

export interface WorkbenchProjectData {
  schemaVersion: "2.0";
  exportTimestamp: string;
  rootPackageName: string;
  sysmlSource: string;
  activeViewType: string;
  activeTheme?: string;
  sidecarPositions: Record<string, NodeLayoutPosition>;
  layersState?: Record<string, { visible: boolean; locked: boolean }>;
}

export class JsonExporter {
  public static exportProject(
    viewIR: SysMLViewIR,
    sysmlSource: string,
    options: {
      activeTheme?: string;
      sidecarPositions?: Record<string, NodeLayoutPosition>;
      layersState?: Record<string, { visible: boolean; locked: boolean }>;
    } = {},
  ): string {
    const project: WorkbenchProjectData = {
      schemaVersion: "2.0",
      exportTimestamp: new Date().toISOString(),
      rootPackageName: viewIR.rootPackageName,
      sysmlSource,
      activeViewType: viewIR.viewType,
      activeTheme: options.activeTheme || "auto",
      sidecarPositions: options.sidecarPositions || {},
      layersState: options.layersState,
    };

    return JSON.stringify(project, null, 2);
  }

  public static exportSysml(sysmlSource: string): string {
    return sysmlSource;
  }
}
