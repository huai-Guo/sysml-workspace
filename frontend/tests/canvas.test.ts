import test from "node:test";
import assert from "node:assert/strict";
import { LayoutSidecar } from "../src/canvas/sidecar";
import { resolveTheme, THEMES } from "../src/canvas/themes";
import { runElkLayout } from "../src/canvas/elk_layout";
import { buildNodeAttrs, buildPortItems } from "../src/canvas/shapes";
import type { SysMLViewIR, SysMLViewNode } from "../src/canvas/types";

test("LayoutSidecar stores and recalls manual node positions", () => {
  const sidecar = new LayoutSidecar("test-session-1");
  sidecar.clear();

  assert.equal(sidecar.has("VehicleModel::Vehicle"), false);

  sidecar.set("VehicleModel::Vehicle", {
    x: 150,
    y: 220,
    width: 240,
    height: 120,
  });

  assert.equal(sidecar.has("VehicleModel::Vehicle"), true);
  const pos = sidecar.get("VehicleModel::Vehicle");
  assert.ok(pos);
  assert.equal(pos.x, 150);
  assert.equal(pos.y, 220);
  assert.equal(pos.userMoved, true);
});

test("Theme resolution supports all 3 skins with correct contrast and ISO flags", () => {
  const darkTheme = resolveTheme("cad-blueprint");
  assert.equal(darkTheme.canvasBg, "#0d1219");
  assert.equal(darkTheme.isIso, false);
  assert.equal(darkTheme.node.stroke, "#38bdf8");

  const lightTheme = resolveTheme("syson-clean");
  assert.equal(lightTheme.canvasBg, "#f8fafc");
  assert.equal(lightTheme.isIso, false);
  assert.equal(lightTheme.node.fill, "#ffffff");

  const isoTheme = resolveTheme("iso-drafting");
  assert.equal(isoTheme.canvasBg, "#ffffff");
  assert.equal(isoTheme.isIso, true);
  assert.equal(isoTheme.node.stroke, "#000000");
  assert.equal(isoTheme.edge.strokeWidth, 1.2);
});

test("OMG standard shape attributes distinguish Definition, Usage, Package, State, and Requirement", () => {
  const theme = THEMES["cad-blueprint"];

  const defNode: SysMLViewNode = {
    id: "def1",
    semanticId: "e1",
    qualifiedName: "M::Def",
    name: "Def",
    kind: "PartDefinition",
    shapeCategory: "definition",
    stereotype: "«part def»",
    layer: "L1_Definitions",
    compartments: [],
    ports: [],
  };
  const defAttrs = buildNodeAttrs(defNode, theme) as any;
  assert.equal(defAttrs.body.rx, 0, "Definition should have sharp rectangular corners (rx: 0)");
  assert.equal(defAttrs.packageTab.display, "none");

  const usageNode: SysMLViewNode = {
    id: "usage1",
    semanticId: "e2",
    qualifiedName: "M::part1",
    name: "part1",
    kind: "PartUsage",
    shapeCategory: "usage",
    stereotype: "«part»",
    layer: "L2_Structure",
    compartments: [],
    ports: [],
  };
  const usageAttrs = buildNodeAttrs(usageNode, theme) as any;
  assert.equal(usageAttrs.body.rx, 8, "Usage should have rounded corners (rx: 8)");

  const pkgNode: SysMLViewNode = {
    id: "pkg1",
    semanticId: "e0",
    qualifiedName: "M",
    name: "M",
    kind: "Package",
    shapeCategory: "package",
    stereotype: "«package»",
    layer: "L1_Definitions",
    compartments: [],
    ports: [],
  };
  const pkgAttrs = buildNodeAttrs(pkgNode, theme) as any;
  assert.equal(pkgAttrs.packageTab.display, "block", "Package should render top-left folder tab");

  const stateNode: SysMLViewNode = {
    id: "st1",
    semanticId: "e3",
    qualifiedName: "M::Active",
    name: "Active",
    kind: "StateUsage",
    shapeCategory: "state",
    stereotype: "«state»",
    layer: "L3_Behavior",
    compartments: [],
    ports: [],
  };
  const stateAttrs = buildNodeAttrs(stateNode, theme) as any;
  assert.equal(stateAttrs.body.rx, 16, "State should have pill corners (rx: 16)");
});

test("runElkLayout generates non-overlapping coordinates for multi-node graph with ports", async () => {
  const sampleIR: SysMLViewIR = {
    schemaVersion: "2.0",
    sourceSha256: "test-sha",
    rootPackageName: "PowerSys",
    viewType: "interconnection",
    nodes: [
      {
        id: "battery",
        semanticId: "e1",
        qualifiedName: "PowerSys::battery",
        name: "battery",
        kind: "PartUsage",
        shapeCategory: "usage",
        stereotype: "«part»",
        layer: "L2_Structure",
        compartments: [],
        ports: [
          {
            id: "battery.pOut",
            name: "pOut",
            direction: "out",
            conjugated: false,
            sideHint: "E",
          },
        ],
      },
      {
        id: "motor",
        semanticId: "e2",
        qualifiedName: "PowerSys::motor",
        name: "motor",
        kind: "PartUsage",
        shapeCategory: "usage",
        stereotype: "«part»",
        layer: "L2_Structure",
        compartments: [],
        ports: [
          {
            id: "motor.pIn",
            name: "pIn",
            direction: "in",
            conjugated: false,
            sideHint: "W",
          },
        ],
      },
    ],
    edges: [
      {
        id: "wire1",
        kind: "connection",
        sourceId: "battery",
        sourcePortId: "battery.pOut",
        targetId: "motor",
        targetPortId: "motor.pIn",
        layer: "L4_Connections",
      },
    ],
    summary: {
      displayedNodes: 2,
      displayedEdges: 1,
      omittedElements: 0,
    },
  };

  const layout = await runElkLayout(sampleIR);
  assert.ok(layout.positions.has("battery"));
  assert.ok(layout.positions.has("motor"));

  const posBattery = layout.positions.get("battery")!;
  const posMotor = layout.positions.get("motor")!;

  assert.ok(posBattery.width > 0);
  assert.ok(posBattery.height > 0);
  assert.ok(posMotor.width > 0);
  assert.ok(posMotor.height > 0);

  // In RIGHT-directed layered layout, battery should be positioned to the left of motor
  assert.ok(
    posBattery.x + posBattery.width <= posMotor.x,
    `Nodes must not overlap: battery.right=${posBattery.x + posBattery.width} should be <= motor.left=${posMotor.x}`,
  );
});
