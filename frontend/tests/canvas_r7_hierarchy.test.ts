import test from "node:test";
import assert from "node:assert/strict";
import {
  compileHierarchicalElement,
  getLegalParentOptions,
  isLegalParentKind,
  scanModelHierarchy,
} from "../src/canvas/sysml_grammar";

const SAMPLE_EV_MODEL = `package ElectricalSystem {
    port def PowerPort;
    port def SignalPort;

    part def Battery {
        port powerOut : PowerPort;
    }

    part def Inverter {
        port powerIn : ~PowerPort;
        port powerOut : PowerPort;
        port ctrl : ~SignalPort;
    }

    part vehicle {
        /* doc comment with fake braces { part fake; } */
        part b : Battery;
        part inv : Inverter;
        connection c1 connect b.powerOut to inv.powerIn;
    }
}
`;

test("scanModelHierarchy parses multi-level containers, ignores comments, and collects defs", () => {
  const h = scanModelHierarchy(SAMPLE_EV_MODEL);
  const qNames = h.containers.map((c) => c.qualifiedName);

  assert.ok(qNames.includes("ElectricalSystem"));
  assert.ok(qNames.includes("ElectricalSystem::PowerPort"));
  assert.ok(qNames.includes("ElectricalSystem::Battery"));
  assert.ok(qNames.includes("ElectricalSystem::vehicle"));
  assert.ok(qNames.includes("ElectricalSystem::vehicle::b"));
  assert.ok(qNames.includes("ElectricalSystem::vehicle::inv"));
  assert.ok(!qNames.some((q) => q.includes("fake")), "Must ignore braces/keywords inside comments");

  assert.deepEqual(h.partDefs, ["Battery", "Inverter"]);
  assert.deepEqual(h.portDefs, ["PowerPort", "SignalPort"]);

  const b = h.containers.find((c) => c.qualifiedName === "ElectricalSystem::vehicle::b")!;
  assert.equal(b.isBlock, false);
  assert.equal(b.typeName, "Battery");
  assert.equal(b.depth, 2);
});

test("SysML v2 containment grammar strictly filters legal parent containers", () => {
  const h = scanModelHierarchy(SAMPLE_EV_MODEL);

  // 1. Part Definition can ONLY go inside Package or __root__, NEVER inside PartUsage (`vehicle`, `b`)
  const partDefParents = getLegalParentOptions(h, "part_def", "ElectricalSystem::vehicle::b");
  assert.ok(partDefParents.options.some((o) => o.qualifiedName === "ElectricalSystem"));
  assert.ok(!partDefParents.options.some((o) => o.qualifiedName === "ElectricalSystem::vehicle"));
  assert.ok(!partDefParents.options.some((o) => o.qualifiedName === "ElectricalSystem::vehicle::b"));
  // Nearest legal ancestor of `ElectricalSystem::vehicle::b` for `part_def` is `ElectricalSystem`!
  assert.equal(partDefParents.defaultQualifiedName, "ElectricalSystem");

  // 2. Port can ONLY go inside PartDefinition, PartUsage, or PortDefinition — NEVER directly inside Package
  const portParents = getLegalParentOptions(h, "port", "ElectricalSystem");
  assert.ok(!portParents.options.some((o) => o.qualifiedName === "ElectricalSystem"));
  assert.ok(portParents.options.some((o) => o.qualifiedName === "ElectricalSystem::Battery"));
  assert.ok(portParents.options.some((o) => o.qualifiedName === "ElectricalSystem::vehicle"));
  assert.ok(portParents.options.some((o) => o.qualifiedName === "ElectricalSystem::vehicle::b"));

  // 3. Part Usage allows multi-level nesting inside Package, PartDefinition, and PartUsage (`vehicle` and `vehicle::b`)
  const partParents = getLegalParentOptions(h, "part", "ElectricalSystem::vehicle::b");
  assert.ok(partParents.options.some((o) => o.qualifiedName === "ElectricalSystem"));
  assert.ok(partParents.options.some((o) => o.qualifiedName === "ElectricalSystem::vehicle"));
  assert.ok(partParents.options.some((o) => o.qualifiedName === "ElectricalSystem::vehicle::b"));
  assert.equal(partParents.defaultQualifiedName, "ElectricalSystem::vehicle::b");

  assert.equal(isLegalParentKind("port", "Package"), false);
  assert.equal(isLegalParentKind("part_def", "PartUsage"), false);
  assert.equal(isLegalParentKind("part", "PartUsage"), true);
  assert.equal(isLegalParentKind("state", "StateUsage"), true);
  assert.equal(isLegalParentKind("requirement", "RequirementUsage"), true);
});

test("compileHierarchicalElement upgrades leaf `;` into indented nested `{ ... }` block", () => {
  const updated = compileHierarchicalElement(SAMPLE_EV_MODEL, {
    kind: "part",
    name: "cellPack",
    parentQualifiedName: "ElectricalSystem::vehicle::b",
    typeName: "Battery",
  });

  assert.ok(
    updated.includes("        part b : Battery {\n            part cellPack : Battery;\n        }"),
    `Unexpected compiled nested block:\n${updated}`,
  );

  // Confirm re-scanning finds 3-level nested path immediately!
  const h2 = scanModelHierarchy(updated);
  assert.ok(
    h2.containers.some((c) => c.qualifiedName === "ElectricalSystem::vehicle::b::cellPack"),
    "3rd-level nested part must be immediately discoverable as a container",
  );
});

test("compileHierarchicalElement supports directional & conjugated port creation and rejects illegal parents", () => {
  const withPort = compileHierarchicalElement(SAMPLE_EV_MODEL, {
    kind: "port",
    name: "auxPowerIn",
    parentQualifiedName: "ElectricalSystem::Inverter",
    typeName: "PowerPort",
    direction: "in",
    conjugated: true,
  });

  assert.ok(
    withPort.includes("        in port auxPowerIn : ~PowerPort;\n    }"),
    `Expected conjugated directional port inside Inverter:\n${withPort}`,
  );

  // Reject putting a `port` directly inside a `Package`
  assert.throws(
    () =>
      compileHierarchicalElement(SAMPLE_EV_MODEL, {
        kind: "port",
        name: "illegalPort",
        parentQualifiedName: "ElectricalSystem",
      }),
    /违反 SysML v2 嵌套语法/,
  );

  // Reject putting a `part_def` inside a `PartUsage`
  assert.throws(
    () =>
      compileHierarchicalElement(SAMPLE_EV_MODEL, {
        kind: "part_def",
        name: "IllegalDef",
        parentQualifiedName: "ElectricalSystem::vehicle",
      }),
    /违反 SysML v2 嵌套语法/,
  );
});
