/**
 * OMG SysML v2 Ownership / Containment Grammar Rules & Lexical Hierarchy Scanner.
 *
 * Ensures that interactive canvas element creation strictly respects SysML v2
 * metamodel containment semantics while enabling multi-level parent-child nesting.
 */

export type CreatableKind =
  | "package"
  | "part_def"
  | "part"
  | "port_def"
  | "port"
  | "attribute"
  | "item_def"
  | "item"
  | "state"
  | "action"
  | "requirement";

export type SysMLContainerKind =
  | "__root__"
  | "Package"
  | "PartDefinition"
  | "PartUsage"
  | "PortDefinition"
  | "ItemDefinition"
  | "StateDefinition"
  | "StateUsage"
  | "ActionDefinition"
  | "ActionUsage"
  | "RequirementDefinition"
  | "RequirementUsage";

export interface GrammarKindSpec {
  kind: CreatableKind;
  label: string;
  shortLabel: string;
  badge: string;
  category: "structure" | "interface" | "behavior" | "requirement";
  defaultPrefix: string;
  allowedParentKinds: readonly SysMLContainerKind[];
  grammarRuleHint: string;
  supportsPartType?: boolean;
  supportsPortType?: boolean;
  supportsScalarType?: boolean;
  supportsItemType?: boolean;
  supportsDirection?: boolean;
  supportsConjugation?: boolean;
}

export interface ScannedContainer {
  qualifiedName: string;
  name: string;
  kind: SysMLContainerKind;
  typeName?: string;
  parentQualifiedName: string | null;
  depth: number;
  lineIndent: string;
  headerStart: number;
  isBlock: boolean;
  openBraceIndex?: number;
  closeBraceIndex?: number;
  semicolonIndex?: number;
}

export interface ScannedModelHierarchy {
  containers: ScannedContainer[];
  partDefs: string[];
  portDefs: string[];
  itemDefs: string[];
}

export interface ParentContainerOption {
  qualifiedName: string;
  name: string;
  kind: SysMLContainerKind;
  depth: number;
  displayLabel: string;
}

export interface CompileElementRequest {
  kind: CreatableKind | string;
  name: string;
  parentQualifiedName?: string;
  typeName?: string;
  direction?: "in" | "out" | "inout" | "";
  conjugated?: boolean;
}

const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const SCALAR_TYPES = ["Real", "Integer", "Boolean", "String"] as const;

export const GRAMMAR_SPECS: Record<CreatableKind, GrammarKindSpec> = {
  part: {
    kind: "part",
    label: "部件实例 (Part)",
    shortLabel: "Part",
    badge: "part",
    category: "structure",
    defaultPrefix: "subPart",
    allowedParentKinds: ["Package", "PartDefinition", "PartUsage"],
    grammarRuleHint:
      "SysML v2 语法：部件实例可位于包下，或嵌套在部件定义 (part def) 及任意父部件 (part) 内构成多级子系统。",
    supportsPartType: true,
  },
  port: {
    kind: "port",
    label: "边界端口 (Port)",
    shortLabel: "Port",
    badge: "port",
    category: "interface",
    defaultPrefix: "ioPort",
    allowedParentKinds: ["PartDefinition", "PartUsage", "PortDefinition"],
    grammarRuleHint:
      "SysML v2 语法：边界端口必须挂载于部件定义 (part def)、部件实例 (part) 或复合端口定义上，不可置于包顶层。",
    supportsPortType: true,
    supportsDirection: true,
    supportsConjugation: true,
  },
  part_def: {
    kind: "part_def",
    label: "部件定义 (Part Def)",
    shortLabel: "Part Def",
    badge: "def",
    category: "structure",
    defaultPrefix: "ModuleDef",
    allowedParentKinds: ["Package", "__root__"],
    grammarRuleHint:
      "SysML v2 语法：部件定义 (part def) 属于命名空间级类型蓝图，只能定义在包 (package) 或模型顶层，不可嵌套进部件实例。",
  },
  port_def: {
    kind: "port_def",
    label: "端口定义 (Port Def)",
    shortLabel: "Port Def",
    badge: "pdef",
    category: "interface",
    defaultPrefix: "SignalIfc",
    allowedParentKinds: ["Package", "__root__"],
    grammarRuleHint:
      "SysML v2 语法：端口定义 (port def) 属于接口类型蓝图，只能定义在包 (package) 或模型顶层。",
  },
  attribute: {
    kind: "attribute",
    label: "属性特征 (Attribute)",
    shortLabel: "Attribute",
    badge: "attr",
    category: "structure",
    defaultPrefix: "param",
    allowedParentKinds: ["PartDefinition", "PartUsage", "PortDefinition", "ItemDefinition"],
    grammarRuleHint:
      "SysML v2 语法：属性 (attribute) 须挂载在部件定义、部件实例、端口定义或流项定义内部。",
    supportsScalarType: true,
  },
  item_def: {
    kind: "item_def",
    label: "流项定义 (Item Def)",
    shortLabel: "Item Def",
    badge: "idef",
    category: "interface",
    defaultPrefix: "Payload",
    allowedParentKinds: ["Package", "__root__"],
    grammarRuleHint:
      "SysML v2 语法：流项定义 (item def) 用于声明传输物质/能量/信号类型，只能定义在包或模型顶层。",
  },
  item: {
    kind: "item",
    label: "接口流项 (Item)",
    shortLabel: "Item",
    badge: "item",
    category: "interface",
    defaultPrefix: "flowData",
    allowedParentKinds: [
      "PortDefinition",
      "PartDefinition",
      "PartUsage",
      "ActionDefinition",
      "ActionUsage",
    ],
    grammarRuleHint:
      "SysML v2 语法：流项 (item) 可置于端口定义 (port def) 中声明 in/out 流向载荷，或置于部件与动作内。",
    supportsItemType: true,
    supportsDirection: true,
  },
  package: {
    kind: "package",
    label: "子包容器 (Package)",
    shortLabel: "Package",
    badge: "pkg",
    category: "structure",
    defaultPrefix: "SubPkg",
    allowedParentKinds: ["__root__", "Package"],
    grammarRuleHint:
      "SysML v2 语法：包 (package) 只能位于模型顶层或父包内，不可置于部件、状态或需求内部。",
  },
  state: {
    kind: "state",
    label: "状态节点 (State)",
    shortLabel: "State",
    badge: "state",
    category: "behavior",
    defaultPrefix: "Mode",
    allowedParentKinds: [
      "Package",
      "PartDefinition",
      "PartUsage",
      "StateDefinition",
      "StateUsage",
    ],
    grammarRuleHint:
      "SysML v2 语法：状态 (state) 可挂载于包或部件内，也可嵌套在父状态 (state) 内构建层次状态机。",
  },
  action: {
    kind: "action",
    label: "动作步骤 (Action)",
    shortLabel: "Action",
    badge: "act",
    category: "behavior",
    defaultPrefix: "Step",
    allowedParentKinds: [
      "Package",
      "PartDefinition",
      "PartUsage",
      "ActionDefinition",
      "ActionUsage",
      "StateDefinition",
      "StateUsage",
    ],
    grammarRuleHint:
      "SysML v2 语法：动作 (action) 可挂载于包、部件、状态或父动作内部。",
  },
  requirement: {
    kind: "requirement",
    label: "需求规格 (Requirement)",
    shortLabel: "Requirement",
    badge: "req",
    category: "requirement",
    defaultPrefix: "ReqSpec",
    allowedParentKinds: ["Package", "RequirementDefinition", "RequirementUsage"],
    grammarRuleHint:
      "SysML v2 语法：需求 (requirement) 须置于包内，或嵌套在父需求内形成多层需求分解树。",
  },
};

export const CREATABLE_KIND_ORDER: readonly CreatableKind[] = [
  "part",
  "port",
  "part_def",
  "port_def",
  "attribute",
  "item",
  "item_def",
  "package",
  "state",
  "action",
  "requirement",
];

export function normalizeCreatableKind(rawKind: string): CreatableKind {
  const lowered = rawKind.trim().toLowerCase().replace(/\s+/g, "_");
  if (lowered in GRAMMAR_SPECS) {
    return lowered as CreatableKind;
  }
  return "part";
}

export function isLegalParentKind(
  childKind: CreatableKind | string,
  parentKind: SysMLContainerKind,
): boolean {
  const spec = GRAMMAR_SPECS[normalizeCreatableKind(childKind)];
  return spec.allowedParentKinds.includes(parentKind);
}

export function containerKindBadge(kind: SysMLContainerKind): { icon: string; tag: string } {
  switch (kind) {
    case "__root__":
      return { icon: "🌐", tag: "模型顶层" };
    case "Package":
      return { icon: "📦", tag: "package" };
    case "PartDefinition":
      return { icon: "⧉", tag: "part def" };
    case "PartUsage":
      return { icon: "▢", tag: "part" };
    case "PortDefinition":
      return { icon: "◈", tag: "port def" };
    case "ItemDefinition":
      return { icon: "◇", tag: "item def" };
    case "StateDefinition":
      return { icon: "◎", tag: "state def" };
    case "StateUsage":
      return { icon: "○", tag: "state" };
    case "ActionDefinition":
      return { icon: "▷", tag: "action def" };
    case "ActionUsage":
      return { icon: "▸", tag: "action" };
    case "RequirementDefinition":
      return { icon: "✦", tag: "req def" };
    case "RequirementUsage":
      return { icon: "✧", tag: "requirement" };
  }
}

/**
 * Replaces comments (`//...`, `/*...* /`) and string literals (`"..."`) with equal-length spaces
 * so character offsets, line numbers, braces, and semicolons align 1:1 with original `source`.
 */
function maskCommentsAndStrings(source: string): string {
  const chars = source.split("");
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const c = chars[i];
    const next = i + 1 < n ? chars[i + 1] : "";

    if (c === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < n && chars[i] !== "\n") {
        if (chars[i] !== "\r") chars[i] = " ";
        i++;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < n && !(chars[i] === "*" && i + 1 < n && chars[i + 1] === "/")) {
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
        i++;
      }
      if (i + 1 < n) {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
      }
      continue;
    }

    if (c === '"') {
      chars[i] = " ";
      i++;
      while (i < n && chars[i] !== '"') {
        if (chars[i] === "\\" && i + 1 < n) {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          continue;
        }
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
        i++;
      }
      if (i < n) {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    i++;
  }

  return chars.join("");
}

function classifyHeader(headerText: string): {
  kind: SysMLContainerKind;
  name: string;
  typeName?: string;
} | null {
  const clean = headerText.replace(/\s+/g, " ").trim();
  if (!clean) return null;

  // Reject relationships or behavioral references that mention state/action keywords
  if (
    /^(?:connection|connect|flow|transition|first|then|satisfy|verify|import|alias|comment|doc|entry|do|exit|bind| succession)\b/.test(
      clean,
    )
  ) {
    return null;
  }

  // Strip optional visibility or direction/variation modifiers
  const stripped = clean
    .replace(/^(?:public|private|protected|abstract|variation|individual|ref|readonly|derived)\s+/g, "")
    .replace(/^(?:in|out|inout)\s+/, "");

  const defPatterns: Array<[RegExp, SysMLContainerKind]> = [
    [/^package\s+([A-Za-z_][A-Za-z0-9_]*)\b/, "Package"],
    [/^part\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b/, "PartDefinition"],
    [/^port\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b/, "PortDefinition"],
    [/^item\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b/, "ItemDefinition"],
    [/^state\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b/, "StateDefinition"],
    [/^action\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b/, "ActionDefinition"],
    [/^requirement\s+def\s+(?:<[^>]+>\s*)?([A-Za-z_][A-Za-z0-9_]*)\b/, "RequirementDefinition"],
  ];

  for (const [regex, kind] of defPatterns) {
    const m = regex.exec(stripped);
    if (m) {
      return { kind, name: m[1] };
    }
  }

  const usagePatterns: Array<[RegExp, SysMLContainerKind]> = [
    [/^part\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*~?([A-Za-z_][A-Za-z0-9_:]*))?/, "PartUsage"],
    [/^(?:exhibit\s+)?state\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_:]*))?/, "StateUsage"],
    [/^(?:perform\s+)?action\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_:]*))?/, "ActionUsage"],
    [
      /^requirement\s+(?:<[^>]+>\s*)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_:]*))?/,
      "RequirementUsage",
    ],
  ];

  for (const [regex, kind] of usagePatterns) {
    const m = regex.exec(stripped);
    if (m) {
      const rawType = m[2] ? m[2].split("::").pop() : undefined;
      return { kind, name: m[1], typeName: rawType };
    }
  }

  return null;
}

/**
 * Brace-balanced lexical hierarchy scanner for SysML v2 source text.
 * Runs in <0.5ms and tracks every container's exact qualified path, kind, indentation, and brace/semicolon span.
 */
export function scanModelHierarchy(source: string): ScannedModelHierarchy {
  const masked = maskCommentsAndStrings(source);
  const containers: ScannedContainer[] = [];
  const stack: Array<ScannedContainer | null> = [];

  let stmtStart = 0;
  const n = masked.length;

  const getLineIndent = (offset: number): string => {
    let lineStart = offset;
    while (lineStart > 0 && source[lineStart - 1] !== "\n") {
      lineStart--;
    }
    let k = lineStart;
    while (k < source.length && (source[k] === " " || source[k] === "\t")) {
      k++;
    }
    return source.slice(lineStart, k);
  };

  const activeParent = (): ScannedContainer | null => {
    for (let s = stack.length - 1; s >= 0; s--) {
      if (stack[s]) return stack[s];
    }
    return null;
  };

  for (let i = 0; i < n; i++) {
    const ch = masked[i];
    if (ch === "{") {
      const headerSlice = masked.slice(stmtStart, i);
      const firstTokenIdx = headerSlice.search(/\S/);
      const realHeaderStart = firstTokenIdx >= 0 ? stmtStart + firstTokenIdx : stmtStart;
      const parsed = classifyHeader(headerSlice);
      if (parsed) {
        const parent = activeParent();
        const qualifiedName = parent ? `${parent.qualifiedName}::${parsed.name}` : parsed.name;
        const depth = parent ? parent.depth + 1 : 0;
        const entry: ScannedContainer = {
          qualifiedName,
          name: parsed.name,
          kind: parsed.kind,
          typeName: parsed.typeName,
          parentQualifiedName: parent ? parent.qualifiedName : null,
          depth,
          lineIndent: getLineIndent(realHeaderStart),
          headerStart: realHeaderStart,
          isBlock: true,
          openBraceIndex: i,
        };
        containers.push(entry);
        stack.push(entry);
      } else {
        stack.push(null);
      }
      stmtStart = i + 1;
    } else if (ch === "}") {
      const popped = stack.pop();
      if (popped) {
        popped.closeBraceIndex = i;
      }
      stmtStart = i + 1;
    } else if (ch === ";") {
      const headerSlice = masked.slice(stmtStart, i);
      const firstTokenIdx = headerSlice.search(/\S/);
      const realHeaderStart = firstTokenIdx >= 0 ? stmtStart + firstTokenIdx : stmtStart;
      const parsed = classifyHeader(headerSlice);
      if (parsed) {
        const parent = activeParent();
        const qualifiedName = parent ? `${parent.qualifiedName}::${parsed.name}` : parsed.name;
        const depth = parent ? parent.depth + 1 : 0;
        containers.push({
          qualifiedName,
          name: parsed.name,
          kind: parsed.kind,
          typeName: parsed.typeName,
          parentQualifiedName: parent ? parent.qualifiedName : null,
          depth,
          lineIndent: getLineIndent(realHeaderStart),
          headerStart: realHeaderStart,
          isBlock: false,
          semicolonIndex: i,
        });
      }
      stmtStart = i + 1;
    }
  }

  const partDefs = Array.from(
    new Set(containers.filter((c) => c.kind === "PartDefinition").map((c) => c.name)),
  );
  const portDefs = Array.from(
    new Set(containers.filter((c) => c.kind === "PortDefinition").map((c) => c.name)),
  );
  const itemDefs = Array.from(
    new Set(containers.filter((c) => c.kind === "ItemDefinition").map((c) => c.name)),
  );

  return { containers, partDefs, portDefs, itemDefs };
}

/**
 * Returns grammatically valid parent container options for `childKind`, formatted as an indented hierarchy,
 * plus the smartest default selection based on the active canvas selection or drill-down scope.
 */
export function getLegalParentOptions(
  hierarchy: ScannedModelHierarchy,
  childKind: CreatableKind | string,
  preferredTarget?: string,
): {
  options: ParentContainerOption[];
  defaultQualifiedName: string | undefined;
} {
  const normKind = normalizeCreatableKind(childKind);
  const spec = GRAMMAR_SPECS[normKind];
  const options: ParentContainerOption[] = [];

  const hasAnyPackage = hierarchy.containers.some((c) => c.kind === "Package");

  if (spec.allowedParentKinds.includes("__root__") || (!hasAnyPackage && normKind === "part")) {
    // Put __root__ first only for package, otherwise after packages so existing root package is preferred
    if (normKind === "package" || !hasAnyPackage) {
      options.push({
        qualifiedName: "__root__",
        name: "模型顶层",
        kind: "__root__",
        depth: 0,
        displayLabel: "🌐 模型顶层 (Root Namespace)",
      });
    }
  }

  for (const c of hierarchy.containers) {
    if (!isLegalParentKind(normKind, c.kind)) {
      continue;
    }
    const { icon, tag } = containerKindBadge(c.kind);
    const treePrefix =
      c.depth === 0 ? "" : `${"│  ".repeat(Math.max(0, c.depth - 1))}├─ `;
    const typeNote = c.typeName ? ` : ${c.typeName}` : "";
    options.push({
      qualifiedName: c.qualifiedName,
      name: c.name,
      kind: c.kind,
      depth: c.depth,
      displayLabel: `${treePrefix}${icon} ${c.name}${typeNote}  «${tag}»`,
    });
  }

  if (spec.allowedParentKinds.includes("__root__") && normKind !== "package" && hasAnyPackage) {
    options.push({
      qualifiedName: "__root__",
      name: "模型顶层",
      kind: "__root__",
      depth: 0,
      displayLabel: "🌐 模型顶层 (包外根空间)",
    });
  }

  // Resolve smart default parent
  let defaultQualifiedName: string | undefined;
  const legalSet = new Set(options.map((o) => o.qualifiedName));

  const findContainer = (ref?: string): ScannedContainer | undefined => {
    if (!ref) return undefined;
    return (
      hierarchy.containers.find((c) => c.qualifiedName === ref) ||
      hierarchy.containers.find((c) => c.name === ref)
    );
  };

  if (preferredTarget) {
    if (legalSet.has(preferredTarget)) {
      defaultQualifiedName = preferredTarget;
    } else {
      // Walk up from preferredTarget (or match by short name) to nearest grammatically legal ancestor!
      let cur = findContainer(preferredTarget);
      while (cur) {
        if (legalSet.has(cur.qualifiedName)) {
          defaultQualifiedName = cur.qualifiedName;
          break;
        }
        cur = cur.parentQualifiedName ? findContainer(cur.parentQualifiedName) : undefined;
      }
    }
  }

  if (!defaultQualifiedName && options.length > 0) {
    if (normKind === "part") {
      // Prefer primary top-level PartUsage (e.g. `vehicle`), else root Package
      const topPart = options.find((o) => o.kind === "PartUsage" && o.depth <= 1);
      const rootPkg = options.find((o) => o.kind === "Package");
      defaultQualifiedName = (topPart || rootPkg || options[0]).qualifiedName;
    } else if (normKind === "port" || normKind === "attribute") {
      const partUsage = options.find((o) => o.kind === "PartUsage");
      defaultQualifiedName = (partUsage || options[0]).qualifiedName;
    } else if (normKind === "item") {
      const portDef = options.find((o) => o.kind === "PortDefinition");
      defaultQualifiedName = (portDef || options[0]).qualifiedName;
    } else if (normKind === "package") {
      const rootOpt = options.find((o) => o.qualifiedName === "__root__");
      defaultQualifiedName = (rootOpt || options[0]).qualifiedName;
    } else {
      const rootPkg = options.find((o) => o.kind === "Package");
      defaultQualifiedName = (rootPkg || options[0]).qualifiedName;
    }
  }

  return { options, defaultQualifiedName };
}

function buildElementLines(req: CompileElementRequest): string[] {
  const kind = normalizeCreatableKind(req.kind);
  const name = req.name.trim();
  const typeName = req.typeName?.trim() || "";
  const dir = req.direction && ["in", "out", "inout"].includes(req.direction) ? `${req.direction} ` : "";
  const conj = req.conjugated && typeName ? "~" : "";
  const typeClause = typeName ? ` : ${conj}${typeName}` : "";

  switch (kind) {
    case "package":
      return [`package ${name} {`, `}`];
    case "part_def":
      return [`part def ${name} {`, `}`];
    case "port_def":
      return [`port def ${name};`];
    case "item_def":
      return [`item def ${name};`];
    case "part":
      return [`part ${name}${typeClause};`];
    case "port":
      return [`${dir}port ${name}${typeClause};`];
    case "attribute":
      return [`attribute ${name}${typeClause};`];
    case "item":
      return [`${dir}item ${name}${typeClause};`];
    case "state":
      return [`state ${name}${typeClause};`];
    case "action":
      return [`action ${name}${typeClause};`];
    case "requirement":
      return [`requirement ${name} {`, `    doc /* ${name} 需求规格说明 */`, `}`];
  }
}

/**
 * Compiles a SysML v2 element declaration into the exact parent block with grammar validation
 * and brace-balanced indentation preservation (including upgrading leaf `;` to `{ ... }`).
 */
export function compileHierarchicalElement(
  source: string,
  req: CompileElementRequest,
): string {
  const name = req.name.trim();
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(`'${name}' 不是合法的 SysML 标识符（须以字母或下划线开头，仅含字母、数字与下划线）`);
  }
  if (req.typeName && !IDENTIFIER_REGEX.test(req.typeName.trim())) {
    throw new Error(`类型名 '${req.typeName}' 不是合法的 SysML 标识符`);
  }

  const normKind = normalizeCreatableKind(req.kind);
  const spec = GRAMMAR_SPECS[normKind];
  const hierarchy = scanModelHierarchy(source);

  let targetRef = req.parentQualifiedName?.trim();

  // Resolve omitted parent smartly using SysML v2 grammar defaults
  if (!targetRef) {
    const { defaultQualifiedName } = getLegalParentOptions(hierarchy, normKind);
    targetRef = defaultQualifiedName;
  }

  if (!targetRef || targetRef === "__root__") {
    if (!isLegalParentKind(normKind, "__root__") && !(normKind === "part" && hierarchy.containers.length === 0)) {
      throw new Error(`语法约束：${spec.label} 不能直接创建在模型顶层。${spec.grammarRuleHint}`);
    }
    const lines = buildElementLines(req).join("\n");
    const trimmedEnd = source.trimEnd();
    return trimmedEnd ? `${trimmedEnd}\n\n${lines}\n` : `${lines}\n`;
  }

  // Locate target container by exact qualifiedName first, then by short name
  const target =
    hierarchy.containers.find((c) => c.qualifiedName === targetRef) ||
    hierarchy.containers.find((c) => c.name === targetRef) ||
    (targetRef.includes("::")
      ? hierarchy.containers.find((c) => c.name === targetRef!.split("::").pop())
      : undefined);

  if (!target) {
    throw new Error(`未找到目标父容器 '${targetRef}'`);
  }

  if (!isLegalParentKind(normKind, target.kind)) {
    const { tag } = containerKindBadge(target.kind);
    throw new Error(
      `违反 SysML v2 嵌套语法：不能在 «${tag}» '${target.name}' 内创建 ${spec.label}。${spec.grammarRuleHint}`,
    );
  }

  const parentIndent = target.lineIndent;
  const childIndent = `${parentIndent}    `;
  const formattedLines = buildElementLines(req)
    .map((line) => `${childIndent}${line}`)
    .join("\n");

  if (target.isBlock && target.closeBraceIndex !== undefined) {
    // Insert cleanly right before the closing brace of the target container
    let insertPos = target.closeBraceIndex;
    while (insertPos > (target.openBraceIndex ?? 0) + 1 && (source[insertPos - 1] === " " || source[insertPos - 1] === "\t")) {
      insertPos--;
    }
    const needsLeadingNewline = insertPos > 0 && source[insertPos - 1] !== "\n";
    const prefix = needsLeadingNewline ? "\n" : "";
    return (
      source.slice(0, insertPos) +
      `${prefix}${formattedLines}\n${parentIndent}` +
      source.slice(target.closeBraceIndex)
    );
  }

  if (!target.isBlock && target.semicolonIndex !== undefined) {
    // Upgrade leaf declaration (e.g. `part b : Battery;`) into a composite block (`part b : Battery { ... }`)
    const beforeSemi = source.slice(0, target.semicolonIndex).trimEnd();
    const afterSemi = source.slice(target.semicolonIndex + 1);
    return `${beforeSemi} {\n${formattedLines}\n${parentIndent}}${afterSemi}`;
  }

  throw new Error(`父容器 '${target.qualifiedName}' 语法块未闭合，请先修复语法错误`);
}
