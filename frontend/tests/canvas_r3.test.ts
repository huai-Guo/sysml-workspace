import test from "node:test";
import assert from "node:assert/strict";
import type { SysMLViewIR } from "../src/canvas/types";
import { DrawioExporter } from "../src/canvas/exporters/drawio_exporter";
import { JsonExporter } from "../src/canvas/exporters/json_exporter";
import { SvgExporter } from "../src/canvas/exporters/svg_exporter";
import { DrawioParser } from "../src/canvas/importers/drawio_parser";
import { CanvasImporter } from "../src/canvas/importers/importer";

const sampleViewIR: SysMLViewIR = {
  schemaVersion: "2.0",
  sourceSha256: "abcdef1234567890",
  rootPackageName: "ElectricVehicle",
  viewType: "general",
  summary: {
    displayedNodes: 2,
    displayedEdges: 1,
    omittedElements: 0,
  },
  nodes: [
    {
      id: "node_battery",
      semanticId: "sem_battery",
      qualifiedName: "ElectricVehicle::Battery",
      name: "Battery",
      kind: "part",
      shapeCategory: "usage",
      stereotype: "part",
      layer: "L2_Structure",
      compartments: [
        {
          id: "attributes",
          title: "attributes",
          items: [{ id: "attr_v", text: "voltage: Real = 400" }],
        },
      ],
      ports: [
        {
          id: "p_out",
          name: "output",
          direction: "out",
          conjugated: false,
          sideHint: "E",
        },
      ],
    },
    {
      id: "node_motor",
      semanticId: "sem_motor",
      qualifiedName: "ElectricVehicle::Motor",
      name: "Motor",
      kind: "part",
      shapeCategory: "usage",
      stereotype: "part",
      layer: "L2_Structure",
      compartments: [],
      ports: [
        {
          id: "p_in",
          name: "input",
          direction: "in",
          conjugated: false,
          sideHint: "W",
        },
      ],
    },
  ],
  edges: [
    {
      id: "edge_power",
      kind: "connection",
      sourceId: "node_battery",
      sourcePortId: "p_out",
      targetId: "node_motor",
      targetPortId: "p_in",
      label: "powerFlow",
      layer: "L4_Connections",
    },
  ],
};

const sampleSource = `package ElectricVehicle {
    part Battery {
        port output;
    }
    part Motor {
        port input;
    }
    connection c_power connect Battery.output to Motor.input;
}
`;

test("DrawioExporter generates uncompressed mxfile with embedded sysml metadata", () => {
  const drawio = DrawioExporter.export(sampleViewIR, { sysmlSource: sampleSource });

  // 1. XML root and diagram declaration
  assert.ok(drawio.includes("<mxfile"), "Must be a valid mxfile");
  assert.ok(drawio.includes("<mxGraphModel"), "Must contain mxGraphModel");

  // 2. Embedded metadata on cell 1
  assert.ok(drawio.includes("sysmlSource="), "Must embed sysmlSource attribute");
  assert.ok(drawio.includes(`viewType="general"`), "Must embed viewType");

  // 3. Nodes and Edges representation
  assert.ok(drawio.includes(`id="node_battery"`), "Must export Battery node");
  assert.ok(drawio.includes(`id="node_motor"`), "Must export Motor node");
  assert.ok(drawio.includes(`id="edge_power"`), "Must export power connection edge");
  assert.ok(drawio.includes("edgeStyle=orthogonalEdgeStyle"), "Edges must be orthogonal");
});

test("JsonExporter exports and serializes .sysmlwb.json project bundle", () => {
  const jsonStr = JsonExporter.exportProject(sampleViewIR, sampleSource, {
    activeTheme: "cad-blueprint",
    sidecarPositions: {
      node_battery: { x: 100, y: 150, width: 200, height: 90, userMoved: true },
    },
    layersState: { L2_Structure: { visible: true, locked: false } },
  });

  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.schemaVersion, "2.0");
  assert.equal(parsed.rootPackageName, "ElectricVehicle");
  assert.equal(parsed.activeViewType, "general");
  assert.equal(parsed.activeTheme, "cad-blueprint");
  assert.equal(parsed.sysmlSource, sampleSource);
  assert.equal(parsed.sidecarPositions.node_battery.x, 100);
  assert.equal(parsed.sidecarPositions.node_battery.y, 150);
});

test("DrawioParser parses diagram with metadata and restores positions without loss", () => {
  const exported = DrawioExporter.export(sampleViewIR, {
    sysmlSource: sampleSource,
    nodePositions: new Map([
      ["node_battery", { x: 150, y: 220, width: 210, height: 95 }],
      ["node_motor", { x: 420, y: 220, width: 190, height: 90 }],
    ]),
  });

  const parsed = DrawioParser.parse(exported);
  assert.equal(parsed.hasMetadata, true);
  assert.equal(parsed.sysmlSource, sampleSource);
  assert.equal(parsed.viewType, "general");

  // Verify position coordinates were extracted
  const batPos = parsed.updatedPositions.get("node_battery");
  assert.ok(batPos, "Must extract node_battery position");
  assert.equal(batPos?.x, 150);
  assert.equal(batPos?.y, 220);
});

test("DrawioParser reverse-compiles plain external hand-drawn diagram into valid SysML v2", () => {
  // Plain hand-drawn Draw.io XML without any workbench metadata
  const plainDrawioXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="d1" name="Page-1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <!-- Container Parent Box -->
        <mxCell id="box_car" value="CarSystem" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="400" height="240" as="geometry" />
        </mxCell>
        <!-- Child Box 1 -->
        <mxCell id="box_eng" value="Engine" vertex="1" parent="box_car">
          <mxGeometry x="60" y="80" width="120" height="60" as="geometry" />
        </mxCell>
        <!-- Child Box 2 -->
        <mxCell id="box_wheel" value="Wheel" vertex="1" parent="box_car">
          <mxGeometry x="240" y="80" width="120" height="60" as="geometry" />
        </mxCell>
        <!-- Connector line -->
        <mxCell id="wire_torque" value="driveTorque" edge="1" parent="box_car" source="box_eng" target="box_wheel">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

  const parsed = DrawioParser.parse(plainDrawioXml);
  assert.equal(parsed.hasMetadata, false, "Must detect no embedded metadata");

  const code = parsed.sysmlSource;
  assert.ok(code.includes("package ImportedSystem {"));
  assert.ok(code.includes("part def CarSystem {"));
  assert.ok(code.includes("part Engine;"));
  assert.ok(code.includes("part Wheel;"));
  assert.ok(code.includes("connection driveTorque connect Engine to Wheel;"));
});

test("CanvasImporter routes various file types correctly", () => {
  // 1. SysML text
  const r1 = CanvasImporter.importContent("model.sysml", sampleSource);
  assert.equal(r1.kind, "sysml");
  if (r1.kind === "sysml") assert.equal(r1.source, sampleSource);

  // 2. Project JSON
  const jsonStr = JsonExporter.exportProject(sampleViewIR, sampleSource);
  const r2 = CanvasImporter.importContent("project.sysmlwb.json", jsonStr);
  assert.equal(r2.kind, "workbench");
  if (r2.kind === "workbench") assert.equal(r2.project.rootPackageName, "ElectricVehicle");

  // 3. Drawio
  const drawioStr = DrawioExporter.export(sampleViewIR, { sysmlSource: sampleSource });
  const r3 = CanvasImporter.importContent("diagram.drawio", drawioStr);
  assert.equal(r3.kind, "drawio");
  if (r3.kind === "drawio") assert.equal(r3.result.sysmlSource, sampleSource);

  // 4. SVG with embedded metadata
  const dummySvg = `<svg xmlns="http://www.w3.org/2000/svg">
    <metadata id="sysml-workbench-data">
      <script type="application/json">${jsonStr}</script>
    </metadata>
    <rect x="0" y="0" width="100" height="100" />
  </svg>`;
  const r4 = CanvasImporter.importContent("drawing.svg", dummySvg);
  assert.equal(r4.kind, "workbench");
  if (r4.kind === "workbench") assert.equal(r4.project.rootPackageName, "ElectricVehicle");
});
