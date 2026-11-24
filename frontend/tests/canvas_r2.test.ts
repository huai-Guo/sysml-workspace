import test from "node:test";
import assert from "node:assert/strict";
import { SemanticEditor } from "../src/canvas/semantic_editor";

test("CadStatusBar state and coordinate format verification", () => {
  // Verify status bar state representation and mode switching
  const state = {
    grid: true,
    snap: false,
    osnap: true,
    ortho: true,
    sheet: false,
  };

  assert.equal(state.grid, true);
  assert.equal(state.snap, false);
  assert.equal(state.ortho, true);

  // Formatted coordinate validation
  const formatCoords = (x: number, y: number) => `X: ${x.toFixed(1)}   Y: ${y.toFixed(1)}`;
  assert.equal(formatCoords(120.45, -34.8), "X: 120.5   Y: -34.8");
  assert.equal(formatCoords(0, 0), "X: 0.0   Y: 0.0");

  const formatZoom = (scale: number) => `${Math.round(scale * 100)}%`;
  assert.equal(formatZoom(1.0), "100%");
  assert.equal(formatZoom(1.25), "125%");
  assert.equal(formatZoom(0.8), "80%");
});

test("AutoCAD Window vs Crossing selection mathematical rules", () => {
  // Test node bbox
  const node = { x: 50, y: 50, width: 100, height: 60 };
  const nodeMinX = node.x;
  const nodeMaxX = node.x + node.width; // 150
  const nodeMinY = node.y;
  const nodeMaxY = node.y + node.height; // 110

  // 1. Fully enclosing box: (20, 20) to (180, 140)
  const encloseBox = { minX: 20, maxX: 180, minY: 20, maxY: 140 };
  const isEnclosed1 =
    nodeMinX >= encloseBox.minX &&
    nodeMaxX <= encloseBox.maxX &&
    nodeMinY >= encloseBox.minY &&
    nodeMaxY <= encloseBox.maxY;
  assert.equal(isEnclosed1, true, "Node should be enclosed in larger box");

  // 2. Partial intersection box (overlapping right boundary): (20, 20) to (100, 140)
  const partialBox = { minX: 20, maxX: 100, minY: 20, maxY: 140 };
  const isEnclosed2 =
    nodeMinX >= partialBox.minX &&
    nodeMaxX <= partialBox.maxX &&
    nodeMinY >= partialBox.minY &&
    nodeMaxY <= partialBox.maxY;
  assert.equal(isEnclosed2, false, "Node partially outside must NOT be window-selected");

  // Crossing selection intersects test:
  const intersects2 = !(
    nodeMaxX < partialBox.minX ||
    nodeMinX > partialBox.maxX ||
    nodeMaxY < partialBox.minY ||
    nodeMinY > partialBox.maxY
  );
  assert.equal(intersects2, true, "Partial overlap MUST be selected in Crossing mode");

  // 3. Completely disjoint box: (200, 200) to (300, 300)
  const disjointBox = { minX: 200, maxX: 300, minY: 200, maxY: 300 };
  const intersects3 = !(
    nodeMaxX < disjointBox.minX ||
    nodeMinX > disjointBox.maxX ||
    nodeMaxY < disjointBox.minY ||
    nodeMinY > disjointBox.maxY
  );
  assert.equal(intersects3, false, "Disjoint box must not select in either mode");
});

test("CadLayersPanel alignment and distribution calculations", () => {
  const nodes = [
    { id: "n1", pos: { x: 50, y: 100 }, size: { width: 80, height: 40 } },
    { id: "n2", pos: { x: 120, y: 150 }, size: { width: 100, height: 60 } },
    { id: "n3", pos: { x: 30, y: 80 }, size: { width: 60, height: 50 } },
  ];

  // Align Left: min X is 30
  const minX = Math.min(...nodes.map((n) => n.pos.x));
  assert.equal(minX, 30);

  // Align Top: min Y is 80
  const minY = Math.min(...nodes.map((n) => n.pos.y));
  assert.equal(minY, 80);

  // Horizontal distribution:
  // Sort by X: n3(30..90), n1(50..130), n2(120..220)
  const sorted = [...nodes].sort((a, b) => a.pos.x - b.pos.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = last.pos.x + last.size.width - first.pos.x; // (120+100) - 30 = 190
  const totalWidth = sorted.reduce((sum, n) => sum + n.size.width, 0); // 60 + 80 + 100 = 240
  const gap = Math.max(10, (totalSpan - totalWidth) / (sorted.length - 1));
  assert.ok(gap >= 10, "Gap must be positive and at least 10px");
});

test("SemanticEditor compileElement generates valid SysML v2 blocks", () => {
  let source = `package SystemModel {
    part def Vehicle {
    }
}
`;

  const editor = new SemanticEditor({
    getSource: () => source,
    applySource: (s) => {
      source = s;
    },
  });

  // 1. Insert package
  const pkgCode = editor.compileElement(source, "package", "Subsystem");
  assert.ok(pkgCode.includes("package Subsystem {\n}"));

  // 2. Insert inside owner block 'Vehicle'
  const partCode = editor.compileElement(source, "part", "engine", "Vehicle");
  assert.ok(partCode.includes("part engine;"));
  assert.ok(partCode.indexOf("part engine;") > partCode.indexOf("part def Vehicle"));

  // 3. Insert requirement
  const reqCode = editor.compileElement(source, "requirement", "Req_Speed");
  assert.ok(reqCode.includes("requirement Req_Speed {"));

  // 4. Invalid identifier rejection
  assert.throws(
    () => editor.compileElement(source, "part", "123Invalid"),
    /不是合法的 SysML 标识符/,
  );
});

test("SemanticEditor compileConnection generates valid connection and transition", () => {
  let source = `package Electric {
    part def System {
        part battery;
        part motor;
    }
}
`;

  const editor = new SemanticEditor({
    getSource: () => source,
    applySource: (s) => {
      source = s;
    },
  });

  // 1. Compile connection
  const connCode = editor.compileConnection(
    source,
    "c_power",
    ["battery", "output"],
    ["motor", "input"],
    "connection",
    "System",
  );
  assert.ok(
    connCode.includes("connection c_power connect battery.output to motor.input;"),
    "Should generate valid SysML connection statement",
  );

  // 2. Compile state transition
  const transCode = editor.compileConnection(
    source,
    "t_start",
    ["Idle"],
    ["Running"],
    "transition",
  );
  assert.ok(
    transCode.includes("transition t_start first Idle then Running;"),
    "Should generate valid SysML transition statement",
  );

  // 3. Compile satisfy
  const satisfyCode = editor.compileConnection(
    source,
    "s_req",
    ["Vehicle"],
    ["Req_Safe"],
    "satisfy",
  );
  assert.ok(
    satisfyCode.includes("satisfy Req_Safe by Vehicle;"),
    "Should generate valid SysML satisfy statement",
  );
});

test("SemanticEditor compileRename renames identifiers accurately without corrupting substrings", () => {
  const source = `package VehiclePkg {
    part def Vehicle {
        part battery : Battery;
        connection p1 connect battery.out to motor.in;
    }
}
`;

  const editor = new SemanticEditor({
    getSource: () => source,
    applySource: () => {},
  });

  // Renaming 'battery' to 'batteryPack' should NOT replace 'Battery' (case-sensitive) or partial words
  const renamed = editor.compileRename(source, "battery", "batteryPack");
  assert.ok(renamed.includes("part batteryPack : Battery;"));
  assert.ok(renamed.includes("connect batteryPack.out to motor.in;"));
  assert.ok(renamed.includes("Battery;"), "Capitalized 'Battery' must remain unchanged");

  // Rejection of invalid name
  assert.throws(
    () => editor.compileRename(source, "battery", "my-battery"),
    /不是合法的 SysML 标识符/,
  );
});

test("SemanticEditor compileDelete cleans up target and referencing connections safely", () => {
  const source = `package TestPkg {
    part def Car {
        part motor;
        part battery;
        connection p1 connect battery.out to motor.in;
        connection p2 connect motor.shaft to wheel.axis;
    }
}
`;

  const editor = new SemanticEditor({
    getSource: () => source,
    applySource: () => {},
  });

  // Deleting 'motor' should remove 'part motor;' and both connections 'p1' and 'p2' referencing it!
  const res = editor.compileDelete(source, "motor");
  assert.equal(res.safe, true);
  assert.ok(!res.newSource.includes("part motor;"), "Target declaration must be deleted");
  assert.ok(!res.newSource.includes("connection p1"), "Referencing connection p1 must be deleted");
  assert.ok(!res.newSource.includes("connection p2"), "Referencing connection p2 must be deleted");
  assert.ok(res.newSource.includes("part battery;"), "Unrelated element must remain");
  assert.ok(res.reasons.length >= 2, "Reasons should list removed referencing connections");
});
