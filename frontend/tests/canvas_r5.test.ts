import test from "node:test";
import assert from "node:assert/strict";
import type { SysMLViewIR, SysMLViewNode } from "../src/canvas/types";
import { resolveTheme, THEMES } from "../src/canvas/themes";
import { estimateNodeDimensions } from "../src/canvas/elk_layout";
import { buildNodeAttrs, buildPortItems } from "../src/canvas/shapes";

const compoundViewIR: SysMLViewIR = {
  schemaVersion: "2.0",
  sourceSha256: "abc123456789",
  rootPackageName: "SpaceStation",
  viewType: "general",
  summary: {
    displayedNodes: 3,
    displayedEdges: 0,
    omittedElements: 0,
  },
  nodes: [
    {
      id: "habitat_module",
      semanticId: "sem_habitat",
      qualifiedName: "SpaceStation::HabitatModule",
      name: "HabitatModule",
      kind: "part",
      shapeCategory: "usage",
      stereotype: "part",
      layer: "L2_Structure",
      compartments: [
        {
          id: "attributes",
          title: "attributes",
          items: [{ id: "c1", text: "pressure: Real = 101.3" }, { id: "c2", text: "oxygenLevel: Real = 21.0" }],
        },
      ],
      ports: [{ id: "p_air", name: "airPort", direction: "inout", typeName: "FluidPort", conjugated: false }],
    },
    {
      id: "life_support",
      semanticId: "sem_eclss",
      qualifiedName: "SpaceStation::HabitatModule::LifeSupport",
      name: "LifeSupport",
      kind: "part",
      parentId: "habitat_module",
      shapeCategory: "usage",
      stereotype: "part",
      layer: "L2_Structure",
      compartments: [],
      ports: [{ id: "p_scrub", name: "scrubber", direction: "in", typeName: "AirPort", conjugated: false }],
    },
    {
      id: "co2_scrubber",
      semanticId: "sem_scrubber",
      qualifiedName: "SpaceStation::HabitatModule::LifeSupport::CO2Scrubber",
      name: "CO2Scrubber",
      kind: "part",
      parentId: "life_support",
      shapeCategory: "usage",
      stereotype: "part",
      layer: "L2_Structure",
      compartments: [],
      ports: [],
    },
  ],
  edges: [],
};

test("R5.1: Themes are streamlined to 3 pure skins without mechanical frame", () => {
  // 1. Exactly 3 themes
  const themeKeys = Object.keys(THEMES);
  assert.strictEqual(themeKeys.length, 3);
  assert.ok(themeKeys.includes("cad-blueprint"));
  assert.ok(themeKeys.includes("syson-clean"));
  assert.ok(themeKeys.includes("iso-drafting"));

  // 2. All skins have isIso = false (no mechanical frame)
  for (const key of themeKeys) {
    const t = THEMES[key as keyof typeof THEMES];
    assert.strictEqual(t.isIso, false, `Theme ${key} must not have isIso set`);
  }

  // 3. Theme resolution
  const darkTheme = resolveTheme("cad-blueprint");
  assert.strictEqual(darkTheme.name, "CAD Dark Blueprint");
  assert.strictEqual(darkTheme.canvasBg, "#0d1219");

  const lightTheme = resolveTheme("syson-clean");
  assert.strictEqual(lightTheme.name, "SysON Clean Light");
  assert.strictEqual(lightTheme.canvasBg, "#f8fafc");

  const bwTheme = resolveTheme("iso-drafting");
  assert.strictEqual(bwTheme.name, "Paper Clean B&W");
  assert.strictEqual(bwTheme.canvasBg, "#ffffff");
});

test("R5.2: Compound container layout allocates dedicated cavity and does not clamp width", () => {
  const parentNode = compoundViewIR.nodes[0];
  const leafNode = compoundViewIR.nodes[2];

  // 1. Compound container dimension calculation
  const parentDim = estimateNodeDimensions(parentNode, true);
  // Header 44 + compartment (24 + 2*18 + 8 = 68) + 20 = 132px topPadding
  assert.ok(parentDim.topPadding >= 100, `Parent topPadding should be >= 100, got ${parentDim.topPadding}`);
  assert.ok(parentDim.width >= 300, `Compound container width should not be squashed: ${parentDim.width}`);

  // 2. Leaf node dimension calculation
  const leafDim = estimateNodeDimensions(leafNode, false);
  assert.ok(leafDim.width <= 360, `Leaf node width should be clamped to max 360, got ${leafDim.width}`);
});

test("R5.2: Node attrs reflect depth tints, compound buttons, and zIndex ordering", () => {
  const theme = resolveTheme("cad-blueprint");
  const parentNode = compoundViewIR.nodes[0];
  const leafNode = compoundViewIR.nodes[2];

  // 1. Compound parent attrs (depth = 0)
  const parentAttrs = buildNodeAttrs(parentNode, theme, {
    depth: 0,
    isCompound: true,
    isCollapsed: false,
    lodTier: "meso",
  }) as Record<string, Record<string, unknown>>;

  assert.strictEqual(parentAttrs.collapseBtn.display, "block", "Compound node should show collapseBtn");
  assert.strictEqual(parentAttrs.collapseBtn.text, "[-]", "Expanded compound node should show [-]");
  assert.strictEqual(parentAttrs.drillBtn.display, "none", "Drill-down uses clean double-click without redundant header icon");

  // 2. Leaf node attrs (depth = 2)
  const leafAttrs = buildNodeAttrs(leafNode, theme, {
    depth: 2,
    isCompound: false,
    isCollapsed: false,
    lodTier: "meso",
  }) as Record<string, Record<string, unknown>>;

  assert.strictEqual(leafAttrs.collapseBtn.display, "none", "Leaf node should hide collapseBtn");
  assert.strictEqual(leafAttrs.drillBtn.display, "none", "Leaf node should hide drillBtn");
  assert.notStrictEqual(
    parentAttrs.body.fill,
    leafAttrs.body.fill,
    "Depth 0 parent and depth 2 child should have depth-tinted cavity brightness",
  );
});

test("R5.3: 3-Tier Semantic Zoom LOD scales font and compensates stroke in macro view", () => {
  const theme = resolveTheme("cad-blueprint");
  const node = compoundViewIR.nodes[0];

  // 1. Macro tier (scale = 0.35)
  const macroAttrs = buildNodeAttrs(node, theme, {
    depth: 0,
    isCompound: true,
    lodTier: "macro",
    scale: 0.35,
  }) as Record<string, Record<string, unknown>>;

  // Inverse font compensation: Math.min(26, Math.round(13 / 0.35)) = 26
  assert.strictEqual(macroAttrs.title.fontSize, 26, "Macro title should have inverse font magnification");
  assert.strictEqual(macroAttrs.compartments.display, "none", "Macro view should hide fine compartments");
  assert.ok(
    Number(macroAttrs.body.strokeWidth) >= 3,
    "Macro view should compensate stroke width to maintain visible lines",
  );

  const macroPorts = buildPortItems(node, theme, {
    lodTier: "macro",
    scale: 0.35,
  });
  assert.strictEqual(
    (macroPorts[0].attrs as Record<string, Record<string, unknown>>).text.display,
    "none",
    "Macro view should hide port labels to eliminate noise",
  );

  // 2. Meso tier (scale = 1.0)
  const mesoAttrs = buildNodeAttrs(node, theme, {
    depth: 0,
    isCompound: true,
    lodTier: "meso",
    scale: 1.0,
  }) as Record<string, Record<string, unknown>>;

  assert.strictEqual(mesoAttrs.title.fontSize, 13, "Meso title font should be standard 13");
  assert.strictEqual(mesoAttrs.compartments.display, "block", "Meso view should show core compartments");

  // 3. Micro tier (scale = 1.8)
  const microPorts = buildPortItems(node, theme, {
    lodTier: "micro",
    scale: 1.8,
  });
  const portText = (microPorts[0].attrs as Record<string, Record<string, unknown>>).text.text as string;
  assert.ok(portText.includes("FluidPort"), "Micro view should show full port type signatures");
  assert.ok(portText.includes("airPort"), "Micro view should show port name");
});

test("R5.4: LOD port names are bidirectionally reversible between meso and micro", () => {
  const theme = resolveTheme("cad-blueprint");
  const node = compoundViewIR.nodes[0]; // has airPort, FluidPort, inout

  const mesoPorts = buildPortItems(node, theme, { lodTier: "meso" });
  const microPorts = buildPortItems(node, theme, { lodTier: "micro" });

  const mesoText = (mesoPorts[0].attrs as Record<string, Record<string, unknown>>).text.text as string;
  const microText = (microPorts[0].attrs as Record<string, Record<string, unknown>>).text.text as string;

  assert.strictEqual(mesoText, "◆ airPort");
  assert.strictEqual(microText, "◆ airPort: FluidPort");

  // Re-evaluating meso returns exactly to clean short name
  const mesoReverted = buildPortItems(node, theme, { lodTier: "meso" });
  assert.strictEqual(
    (mesoReverted[0].attrs as Record<string, Record<string, unknown>>).text.text,
    "◆ airPort",
  );
});
