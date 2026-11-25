import test from "node:test";
import assert from "node:assert/strict";
import type { SysMLViewIR, SysMLViewNode } from "../src/canvas/types";
import { resolveTheme } from "../src/canvas/themes";
import { runElkLayout, estimateNodeDimensions } from "../src/canvas/elk_layout";
import { buildNodeAttrs, buildPortItems, formatSysMLPortLabel } from "../src/canvas/shapes";
import { SemanticEditor } from "../src/canvas/semantic_editor";

test("R6-SysON: Multi-line compartments anchor at top and emit crisp horizontal dividers without overlapping header", () => {
  const theme = resolveTheme("syson-clean");
  const inverterDef: SysMLViewNode = {
    id: "EV::Inverter",
    semanticId: "e6",
    qualifiedName: "EV::Inverter",
    name: "Inverter",
    kind: "PartDefinition",
    shapeCategory: "definition",
    stereotype: "«part def»",
    layer: "L1_Definitions",
    compartments: [
      {
        id: "attributes",
        title: "attributes",
        items: [{ id: "a1", text: "efficiency: Real = 0.96" }],
      },
      {
        id: "ports",
        title: "ports",
        items: [
          { id: "p1", text: "in powerIn : ~PowerPort" },
          { id: "p2", text: "out powerOut : PowerPort" },
          { id: "p3", text: "in ctrl : ~SignalPort" },
        ],
      },
    ],
    ports: [],
  };

  const dims = estimateNodeDimensions(inverterDef, false);
  assert.ok(dims.width >= 210, `Node width must accommodate compartment items cleanly: ${dims.width}`);
  assert.ok(dims.height >= 150, `Node height must fit header + 2 compartments: ${dims.height}`);

  const attrs = buildNodeAttrs(inverterDef, theme, {
    lodTier: "meso",
    nodeWidth: dims.width,
  }) as Record<string, Record<string, unknown>>;

  // Critical fix: X6 multi-line text must use textVerticalAnchor: "top" so 4+ lines never shift up into header
  assert.strictEqual(attrs.compartments.textVerticalAnchor, "top");
  assert.strictEqual(attrs.divider.display, "block");
  assert.strictEqual(attrs.divider.height, 1);
  assert.strictEqual(attrs.compartmentDividers.display, "block");
  assert.ok(String(attrs.compartmentDividers.d).startsWith("M 0 "), "Must generate SVG path between compartments");
});

test("R6-SysON: Border ports distinguish standard vs conjugated (~) fill and orient directional arrows by side", () => {
  const theme = resolveTheme("syson-clean");
  const partNode: SysMLViewNode = {
    id: "EV::vehicle::inv",
    semanticId: "e10",
    qualifiedName: "EV::vehicle::inv",
    name: "inv",
    typeLabel: ": Inverter",
    kind: "PartUsage",
    shapeCategory: "usage",
    stereotype: "«part»",
    layer: "L2_Structure",
    compartments: [],
    ports: [
      {
        id: "inv.powerIn",
        name: "powerIn",
        typeName: "PowerPort",
        direction: "in",
        conjugated: true,
        sideHint: "W",
      },
      {
        id: "inv.powerOut",
        name: "powerOut",
        typeName: "PowerPort",
        direction: "out",
        conjugated: false,
        sideHint: "E",
      },
      {
        id: "inv.rawPin",
        name: "rawPin",
        direction: null,
        conjugated: false,
        sideHint: "W",
      },
    ],
  };

  const portItems = buildPortItems(partNode, theme, { lodTier: "meso" }) as Array<{
    id: string;
    group: string;
    attrs: Record<string, Record<string, unknown>>;
  }>;

  // 1. Conjugated W input port: inverted accent fill + rightward arrow into block
  assert.strictEqual(portItems[0].attrs.pin.fill, theme.port.fill);
  assert.strictEqual(portItems[0].attrs.dirGlyph.text, "→");
  assert.strictEqual(portItems[0].attrs.text.text, "→ ~powerIn");

  // 2. Standard E output port: surface node fill + rightward arrow out of block
  assert.strictEqual(portItems[1].attrs.pin.fill, theme.node.fill);
  assert.strictEqual(portItems[1].attrs.dirGlyph.text, "→");
  assert.strictEqual(portItems[1].attrs.text.text, "→ powerOut");

  // 3. Untyped directionless port: clean name without fake box glyph
  assert.strictEqual(formatSysMLPortLabel(partNode.ports[2], "meso"), "rawPin");
});

test("R6-SysON: Two-zone ELK layout separates Definition catalog from left-to-right compound vehicle topology", async () => {
  const ir: SysMLViewIR = {
    schemaVersion: "2.0",
    sourceSha256: "0".repeat(64),
    rootPackageName: "ElectricalSystem",
    viewType: "general",
    summary: { displayedNodes: 7, displayedEdges: 2, omittedElements: 0 },
    nodes: [
      {
        id: "PowerPort",
        semanticId: "e1",
        qualifiedName: "EV::PowerPort",
        name: "PowerPort",
        kind: "PortDefinition",
        shapeCategory: "definition",
        stereotype: "«port def»",
        layer: "L1_Definitions",
        compartments: [],
        ports: [],
      },
      {
        id: "BatteryDef",
        semanticId: "e2",
        qualifiedName: "EV::Battery",
        name: "Battery",
        kind: "PartDefinition",
        shapeCategory: "definition",
        stereotype: "«part def»",
        layer: "L1_Definitions",
        compartments: [],
        ports: [],
      },
      {
        id: "vehicle",
        semanticId: "e3",
        qualifiedName: "EV::vehicle",
        name: "vehicle",
        kind: "PartUsage",
        shapeCategory: "usage",
        stereotype: "«part»",
        layer: "L2_Structure",
        compartments: [],
        ports: [],
      },
      {
        id: "b",
        semanticId: "e4",
        qualifiedName: "EV::vehicle::b",
        name: "b",
        typeLabel: ": Battery",
        parentId: "vehicle",
        kind: "PartUsage",
        shapeCategory: "usage",
        stereotype: "«part»",
        layer: "L2_Structure",
        compartments: [],
        ports: [{ id: "b.out", name: "powerOut", direction: "out", conjugated: false, sideHint: "E" }],
      },
      {
        id: "inv",
        semanticId: "e5",
        qualifiedName: "EV::vehicle::inv",
        name: "inv",
        typeLabel: ": Inverter",
        parentId: "vehicle",
        kind: "PartUsage",
        shapeCategory: "usage",
        stereotype: "«part»",
        layer: "L2_Structure",
        compartments: [],
        ports: [
          { id: "inv.in", name: "powerIn", direction: "in", conjugated: true, sideHint: "W" },
          { id: "inv.out", name: "powerOut", direction: "out", conjugated: false, sideHint: "E" },
        ],
      },
      {
        id: "m",
        semanticId: "e6",
        qualifiedName: "EV::vehicle::m",
        name: "m",
        typeLabel: ": Motor",
        parentId: "vehicle",
        kind: "PartUsage",
        shapeCategory: "usage",
        stereotype: "«part»",
        layer: "L2_Structure",
        compartments: [],
        ports: [{ id: "m.in", name: "powerIn", direction: "in", conjugated: true, sideHint: "W" }],
      },
    ],
    edges: [
      {
        id: "c1",
        kind: "connection",
        sourceId: "b",
        sourcePortId: "b.out",
        targetId: "inv",
        targetPortId: "inv.in",
        layer: "L4_Connections",
      },
      {
        id: "c2",
        kind: "connection",
        sourceId: "inv",
        sourcePortId: "inv.out",
        targetId: "m",
        targetPortId: "m.in",
        layer: "L4_Connections",
      },
    ],
  };

  const layout = await runElkLayout(ir);
  const posPortDef = layout.positions.get("PowerPort")!;
  const posVehicle = layout.positions.get("vehicle")!;
  const posB = layout.positions.get("b")!;
  const posInv = layout.positions.get("inv")!;
  const posM = layout.positions.get("m")!;

  // Catalog band sits cleanly above the compound `vehicle` container
  assert.ok(
    posPortDef.y + posPortDef.height < posVehicle.y,
    `Catalog definitions (${posPortDef.y + posPortDef.height}) must sit cleanly above vehicle (${posVehicle.y})`,
  );

  // Inside `vehicle`, signal flow strictly progresses Left -> Center -> Right: b -> inv -> m
  assert.ok(posB.x + posB.width <= posInv.x, "Battery `b` must be laid out left of Inverter `inv`");
  assert.ok(posInv.x + posInv.width <= posM.x, "Inverter `inv` must be laid out left of Motor `m`");
});

test("R7-UX: Display toggles control compartments/port types and Palette inserts valid child SysML into leaf parts", () => {
  const theme = resolveTheme("syson-clean");
  const node: SysMLViewNode = {
    id: "EV::Battery",
    semanticId: "e3",
    qualifiedName: "EV::Battery",
    name: "Battery",
    kind: "PartDefinition",
    shapeCategory: "definition",
    stereotype: "«part def»",
    layer: "L1_Definitions",
    compartments: [{ id: "attributes", title: "attributes", items: [{ id: "a1", text: "v: Real" }] }],
    ports: [{ id: "p1", name: "powerOut", typeName: "PowerPort", direction: "out", conjugated: false, sideHint: "E" }],
  };

  const hiddenCompAttrs = buildNodeAttrs(node, theme, {
    lodTier: "meso",
    forceHideCompartments: true,
  }) as Record<string, Record<string, unknown>>;
  assert.strictEqual(hiddenCompAttrs.compartments.display, "none");

  const forcedTypePorts = buildPortItems(node, theme, {
    lodTier: "meso",
    forceShowPortTypes: true,
  }) as Array<{ attrs: Record<string, Record<string, unknown>> }>;
  assert.strictEqual(forcedTypePorts[0].attrs.text.text, "→ powerOut: PowerPort");

  // Leaf `part b : Battery;` expands cleanly into a block when inserting a child `port`
  const editor = new SemanticEditor({
    getSource: () => "",
    applySource: () => {},
  });
  const baseSysml = `package EV {\n    part vehicle {\n        part b : Battery;\n    }\n}\n`;
  const updated = editor.compileElement(baseSysml, "port", "ioPort_1", "b");
  assert.ok(updated.includes("part b : Battery {"), "Leaf part should expand to block");
  assert.ok(updated.includes("port ioPort_1;"), "New port should be inserted inside target part");
});
