import test from "node:test";
import assert from "node:assert/strict";
import type { SysMLViewIR } from "../src/canvas/types";
import { DrawioExporter } from "../src/canvas/exporters/drawio_exporter";
import { DrawioParser } from "../src/canvas/importers/drawio_parser";

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
