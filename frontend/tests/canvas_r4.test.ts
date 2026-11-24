import test from "node:test";
import assert from "node:assert/strict";
import type { SysMLViewIR } from "../src/canvas/types";
import { DrawioExporter } from "../src/canvas/exporters/drawio_exporter";
import { DrawioParser } from "../src/canvas/importers/drawio_parser";
import { DxfExporter } from "../src/canvas/exporters/dxf_exporter";
import { CadCommandParser, CAD_COMMANDS, type CadCommandContext } from "../src/canvas/command_bar";

const nestedSampleViewIR: SysMLViewIR = {
  schemaVersion: "2.0",
  sourceSha256: "fedcba9876543210",
  rootPackageName: "NestedSystem",
  viewType: "general",
  summary: {
    displayedNodes: 2,
    displayedEdges: 0,
    omittedElements: 0,
  },
  nodes: [
    {
      id: "parent_box",
      semanticId: "sem_parent",
      qualifiedName: "NestedSystem::ParentBox",
      name: "ParentBox",
      kind: "part",
      shapeCategory: "usage",
      stereotype: "part",
      layer: "L2_Structure",
      compartments: [],
      ports: [],
    },
    {
      id: "child_item",
      semanticId: "sem_child",
      qualifiedName: "NestedSystem::ParentBox::ChildItem",
      name: "ChildItem",
      kind: "part",
      parentId: "parent_box",
      shapeCategory: "usage",
      stereotype: "«part»", // already wrapped with guillemets
      layer: "L2_Structure",
      compartments: [],
      ports: [],
    },
  ],
  edges: [],
};

test("R3-Bug1: DrawioExporter escapes labels cleanly and calculates nested relative coordinates", () => {
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  positions.set("parent_box", { x: 100, y: 100, width: 300, height: 200 });
  positions.set("child_item", { x: 150, y: 160, width: 100, height: 60 });

  const xml = DrawioExporter.export(nestedSampleViewIR, {
    sysmlSource: "package NestedSystem { part parent_box { part child_item; } }",
    nodePositions: positions,
  });

  // 1. Should NOT contain double-escaped HTML (&amp;lt;b&amp;gt;)
  assert.ok(!xml.includes("&amp;lt;"), "Draw.io label must not be double-escaped");
  assert.ok(xml.includes("&lt;b&gt;ParentBox&lt;/b&gt;"), "Draw.io label should contain single-escaped HTML bold tag");

  // 2. Should strip duplicated «» guillemets
  assert.ok(!xml.includes("&amp;laquo;&amp;laquo;"), "Must not duplicate guillemets");
  assert.ok(!xml.includes("««"), "Must not have literal double guillemets");

  // 3. Child mxCell inside <UserObject> must NOT have redundant id attribute
  assert.ok(
    xml.includes('<UserObject id="child_item"'),
    "UserObject must have id",
  );
  assert.ok(
    !xml.includes('<mxCell id="child_item"'),
    "Child mxCell inside UserObject must omit duplicate id attribute",
  );

  // 4. Nested child coordinate in Draw.io should be relative to parent (150 - 100 = 50, 160 - 100 = 60)
  assert.ok(
    xml.includes('x="50" y="60"'),
    "Child geometry in exported Draw.io must be relative to parent cell",
  );

  // 5. DrawioParser should restore relative coordinates back to absolute (50 + 100 = 150, 60 + 100 = 160)
  const parseResult = DrawioParser.parse(xml);
  assert.ok(parseResult.hasMetadata, "Should recognize metadata");
  const restoredChild = parseResult.updatedPositions.get("child_item");
  assert.ok(restoredChild, "Child item position should be restored");
  assert.strictEqual(restoredChild.x, 150, "Restored child X should be absolute 150");
  assert.strictEqual(restoredChild.y, 160, "Restored child Y should be absolute 160");
});

test("R3-Bug2: DxfExporter outputs complete standard AC1015 tables and uppercase layers", () => {
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  positions.set("parent_box", { x: 50, y: 50, width: 200, height: 100 });

  const edgeVertices = new Map<string, { x: number; y: number }[]>();
  edgeVertices.set("edge_mock", [
    { x: 100, y: 150 },
    { x: 100, y: 250 },
  ]);

  const viewWithEdge: SysMLViewIR = {
    ...nestedSampleViewIR,
    edges: [
      {
        id: "edge_mock",
        kind: "connection",
        sourceId: "parent_box",
        targetId: "child_item",
        layer: "L4_Connections",
        label: "flowSignal",
      },
    ],
  };

  const dxf = DxfExporter.export(viewWithEdge, {
    includeFrame: true,
    nodePositions: positions,
    edgeVertices,
  });

  // 1. Mandatory DXF sections and tables
  assert.ok(dxf.includes("SECTION\n2\nHEADER"), "DXF must have HEADER section");
  assert.ok(dxf.includes("$HANDSEED"), "DXF HEADER must have $HANDSEED");
  assert.ok(dxf.includes("TABLE\n2\nVPORT"), "DXF TABLES must have VPORT table");
  assert.ok(dxf.includes("TABLE\n2\nLTYPE"), "DXF TABLES must have LTYPE table");
  assert.ok(dxf.includes("CONTINUOUS"), "LTYPE table must define CONTINUOUS line type");
  assert.ok(dxf.includes("TABLE\n2\nLAYER"), "DXF TABLES must have LAYER table");
  assert.ok(dxf.includes("TABLE\n2\nSTYLE"), "DXF TABLES must have STYLE table");
  assert.ok(dxf.includes("TABLE\n2\nAPPID"), "DXF TABLES must have APPID table");
  assert.ok(dxf.includes("TABLE\n2\nBLOCK_RECORD"), "DXF TABLES must have BLOCK_RECORD table");
  assert.ok(dxf.includes("*MODEL_SPACE"), "BLOCK_RECORD must contain *MODEL_SPACE");
  assert.ok(dxf.includes("SECTION\n2\nBLOCKS"), "DXF must have BLOCKS section");
  assert.ok(dxf.includes("SECTION\n2\nOBJECTS"), "DXF must have OBJECTS section");
  assert.ok(dxf.includes("AcDbDictionary"), "OBJECTS must have AcDbDictionary");
  assert.ok(dxf.includes("EOF"), "DXF must end with EOF");

  // 2. Layer casing must be uppercase
  assert.ok(dxf.includes("8\nL2_STRUCTURE"), "Entity layers must be uppercase L2_STRUCTURE");
  assert.ok(dxf.includes("8\nL4_CONNECTIONS"), "Entity layers must be uppercase L4_CONNECTIONS");
  assert.ok(!dxf.includes("8\nL2_Structure"), "Must not use mixed case entity layers");

  // 3. Multi-segment edge polyline generated with intermediate vertices
  assert.ok(dxf.includes("LWPOLYLINE"), "Edges must be output as LWPOLYLINE");
});

test("R4.1: CadCommandParser matches commands, aliases and auto-completes", () => {
  // 1. Direct match
  const fit = CadCommandParser.matchCommand("FIT");
  assert.ok(fit, "Should match FIT");
  assert.strictEqual(fit.def.command, "FIT");

  // 2. Case insensitive
  const fitLower = CadCommandParser.matchCommand("fit");
  assert.ok(fitLower, "Should match lowercase fit");

  // 3. Aliases
  const f8 = CadCommandParser.matchCommand("F8");
  assert.ok(f8, "Should match F8 alias");
  assert.strictEqual(f8.def.command, "ORTHO");

  const zf = CadCommandParser.matchCommand("zf");
  assert.ok(zf, "Should match zf alias");
  assert.strictEqual(zf.def.command, "FIT");

  const alignLeft = CadCommandParser.matchCommand("ALIGN LEFT");
  assert.ok(alignLeft, "Should match ALIGN LEFT alias");
  assert.strictEqual(alignLeft.def.command, "ALIGN L");

  // 4. Commands with spaces
  const viewIbd = CadCommandParser.matchCommand("VIEW IBD");
  assert.ok(viewIbd, "Should match VIEW IBD");
  assert.strictEqual(viewIbd.def.command, "VIEW IBD");

  const exportDxf = CadCommandParser.matchCommand("EXPORT DXF");
  assert.ok(exportDxf, "Should match EXPORT DXF");
  assert.strictEqual(exportDxf.def.command, "EXPORT DXF");

  const skinCad = CadCommandParser.matchCommand("SKIN CAD");
  assert.ok(skinCad, "Should match SKIN CAD");
  assert.strictEqual(skinCad.def.command, "SKIN CAD");

  // 5. Suggestions / Autocomplete
  const exportSuggestions = CadCommandParser.suggest("EXP");
  assert.ok(exportSuggestions.length >= 4, "Should suggest all EXPORT commands");
  assert.ok(exportSuggestions.some((s) => s.command === "EXPORT DXF"));
  assert.ok(exportSuggestions.some((s) => s.command === "EXPORT PNG"));

  const alignSuggestions = CadCommandParser.suggest("ALIGN");
  assert.strictEqual(alignSuggestions.length, 6, "Should suggest 6 alignment commands (L, R, T, B, H, V)");

  // 6. Unknown command returns null
  assert.strictEqual(CadCommandParser.matchCommand("UNKNOWN_FOO"), null);
});

test("R4.1: CAD command execution against context", async () => {
  let fitCalled = false;
  let orthoToggled = false;
  let layoutReset = false;
  let selectedAlign: string | null = null;
  let exportedFormat: string | null = null;
  let switchedView: string | null = null;

  const mockCtx: CadCommandContext = {
    zoomFit: () => {
      fitCalled = true;
    },
    toggleOrtho: () => {
      orthoToggled = !orthoToggled;
      return orthoToggled;
    },
    toggleGrid: () => true,
    toggleSnap: () => true,
    toggleOsnap: () => true,
    toggleSheet: () => true,
    alignSelected: (type) => {
      selectedAlign = type;
      return true;
    },
    resetLayout: () => {
      layoutReset = true;
    },
    switchView: (view) => {
      switchedView = view;
      return true;
    },
    setTheme: () => {},
    exportFormat: (fmt) => {
      exportedFormat = fmt;
    },
  };

  const fitCmd = CadCommandParser.matchCommand("FIT")!;
  await fitCmd.def.execute([], mockCtx);
  assert.strictEqual(fitCalled, true, "zoomFit should have been called");

  const orthoCmd = CadCommandParser.matchCommand("ORTHO")!;
  await orthoCmd.def.execute([], mockCtx);
  assert.strictEqual(orthoToggled, true, "toggleOrtho should have been toggled to true");

  const alignCmd = CadCommandParser.matchCommand("ALIGN R")!;
  await alignCmd.def.execute([], mockCtx);
  assert.strictEqual(selectedAlign, "right", "alignSelected should have been called with 'right'");

  const layoutCmd = CadCommandParser.matchCommand("LAYOUT")!;
  await layoutCmd.def.execute([], mockCtx);
  assert.strictEqual(layoutReset, true, "resetLayout should have been called");

  const viewCmd = CadCommandParser.matchCommand("VIEW IBD")!;
  await viewCmd.def.execute([], mockCtx);
  assert.strictEqual(switchedView, "interconnection", "switchView should have been called with 'interconnection'");

  const expCmd = CadCommandParser.matchCommand("EXPORT DXF")!;
  await expCmd.def.execute([], mockCtx);
  assert.strictEqual(exportedFormat, "dxf", "exportFormat should have been called with 'dxf'");
});
