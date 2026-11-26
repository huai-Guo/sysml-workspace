import type { Graph } from "@antv/x6/es";
import type { SysMLViewNode } from "./types";
import {
  CREATABLE_KIND_ORDER,
  GRAMMAR_SPECS,
  SCALAR_TYPES,
  getLegalParentOptions,
  isLegalParentKind,
  normalizeCreatableKind,
  scanModelHierarchy,
  type CreatableKind,
  type ParentContainerOption,
} from "./sysml_grammar";

export interface InsertElementEvent {
  kind: CreatableKind;
  name: string;
  targetParentId?: string;
  typeName?: string;
  direction?: "in" | "out" | "inout" | "";
  conjugated?: boolean;
  position?: { x: number; y: number };
}

const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class SysMLPalette {
  private container: HTMLElement;
  private graph: Graph;
  private popoverEl: HTMLElement;
  private isVisible = false;
  private onInsert?: (event: InsertElementEvent) => void;
  private getDefaultParentId?: () => string | undefined;
  private getSource?: () => string;
  private itemCounters: Record<string, number> = {};
  private outsideClickListener: (e: MouseEvent) => void;

  // Interactive composer state
  private selectedKind: CreatableKind = "part";
  private selectedParent = "";
  private customName = "";
  private nameDirty = false;
  private selectedType = "";
  private selectedDirection: "in" | "out" | "inout" | "" = "";
  private conjugated = false;
  private keepOpen = false;
  private forcedParentOverride?: string;

  constructor(
    container: HTMLElement,
    graph: Graph,
    options: {
      onInsert?: (event: InsertElementEvent) => void;
      getDefaultParentId?: () => string | undefined;
      getSource?: () => string;
    } = {},
  ) {
    this.container = container;
    this.graph = graph;
    this.onInsert = options.onInsert;
    this.getDefaultParentId = options.getDefaultParentId;
    this.getSource = options.getSource;

    const existing = document.getElementById("palette-menu-popover");
    if (existing) {
      this.popoverEl = existing;
    } else {
      this.popoverEl = document.createElement("div");
      this.popoverEl.id = "palette-menu-popover";
      this.popoverEl.className = "canvas-palette-popover";
      this.popoverEl.hidden = true;
      container.appendChild(this.popoverEl);
    }

    this.outsideClickListener = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const toggleBtn = document.getElementById("toggle-palette-btn");
      if (
        this.isVisible &&
        target &&
        !this.popoverEl.contains(target) &&
        (!toggleBtn || !toggleBtn.contains(target))
      ) {
        this.hide();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("click", this.outsideClickListener);
    }

    this.render();
    this.setupCanvasDrop();
  }

  public toggle(show?: boolean): void {
    const next = show !== undefined ? show : !this.isVisible;
    if (next && !this.isVisible) {
      this.forcedParentOverride = undefined;
      this.syncStateForOpen();
    }
    this.isVisible = next;
    this.popoverEl.hidden = !this.isVisible;
    if (this.isVisible) {
      const layersPop = document.getElementById("layers-menu-popover");
      const exportPop = document.getElementById("export-menu-popover");
      if (layersPop) layersPop.hidden = true;
      if (exportPop) exportPop.hidden = true;
      this.render();
      const nameInput = this.popoverEl.querySelector<HTMLInputElement>("#palette-name-input");
      if (nameInput) {
        setTimeout(() => {
          nameInput.focus();
          nameInput.select();
        }, 10);
      }
    }
  }

  public openForParent(parentQualifiedName: string, preferredKind?: CreatableKind): void {
    this.forcedParentOverride = parentQualifiedName;
    if (preferredKind) {
      this.selectedKind = preferredKind;
    } else {
      const hierarchy = scanModelHierarchy(this.getSource?.() || "");
      const target =
        hierarchy.containers.find((c) => c.qualifiedName === parentQualifiedName) ||
        hierarchy.containers.find((c) => c.name === parentQualifiedName);
      if (target) {
        if (target.kind === "PortDefinition") {
          this.selectedKind = "item";
        } else if (target.kind === "StateDefinition" || target.kind === "StateUsage") {
          this.selectedKind = "state";
        } else if (target.kind === "RequirementDefinition" || target.kind === "RequirementUsage") {
          this.selectedKind = "requirement";
        } else if (!isLegalParentKind(this.selectedKind, target.kind)) {
          this.selectedKind = "part";
        }
      }
    }
    this.nameDirty = false;
    this.syncStateForOpen();
    this.isVisible = true;
    this.popoverEl.hidden = false;
    const layersPop = document.getElementById("layers-menu-popover");
    const exportPop = document.getElementById("export-menu-popover");
    if (layersPop) layersPop.hidden = true;
    if (exportPop) exportPop.hidden = true;
    this.render();
  }

  public toggleCollapse(collapse?: boolean): void {
    this.toggle(collapse !== undefined ? !collapse : undefined);
  }

  public show(): void {
    this.toggle(true);
  }

  public hide(): void {
    this.toggle(false);
  }

  private generateUniqueName(prefix: string, existingSource: string = ""): string {
    const src = existingSource || this.getSource?.() || "";
    for (let i = 1; i < 999; i++) {
      this.itemCounters[prefix] = Math.max(this.itemCounters[prefix] || 0, i);
      const candidate = `${prefix}_${this.itemCounters[prefix]}`;
      if (!src || !new RegExp(`\\b${candidate}\\b`).test(src)) {
        return candidate;
      }
      this.itemCounters[prefix]++;
    }
    return `${prefix}_${Date.now() % 1000}`;
  }

  private resolveActiveParentCandidate(): string | undefined {
    if (this.forcedParentOverride) {
      return this.forcedParentOverride;
    }
    const selected = this.graph.getSelectedCells().filter((c) => c.isNode());
    if (selected.length === 1) {
      const vn = (selected[0].getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
      if (vn) {
        return vn.qualifiedName || vn.name;
      }
    }
    return this.getDefaultParentId?.();
  }

  private syncStateForOpen(): void {
    const spec = GRAMMAR_SPECS[this.selectedKind];
    const src = this.getSource?.() || "";
    const hierarchy = scanModelHierarchy(src);
    const preferred = this.resolveActiveParentCandidate();
    const { options, defaultQualifiedName } = getLegalParentOptions(
      hierarchy,
      this.selectedKind,
      preferred,
    );

    if (
      !this.selectedParent ||
      this.forcedParentOverride ||
      !options.some((o) => o.qualifiedName === this.selectedParent)
    ) {
      this.selectedParent = defaultQualifiedName || "";
    }

    if (!this.nameDirty || !this.customName) {
      this.customName = this.generateUniqueName(spec.defaultPrefix, src);
      this.nameDirty = false;
    }

    if (this.selectedKind === "item" && !this.selectedDirection) {
      this.selectedDirection = "out";
    } else if (this.selectedKind !== "port" && this.selectedKind !== "item") {
      this.selectedDirection = "";
    }
    if (this.selectedKind !== "port") {
      this.conjugated = false;
    }
  }

  private handleKindSelect(kind: CreatableKind): void {
    if (this.selectedKind === kind) return;
    this.selectedKind = kind;
    this.selectedType = "";
    this.conjugated = false;
    this.selectedDirection = kind === "item" ? "out" : "";
    if (!this.nameDirty) {
      this.customName = this.generateUniqueName(GRAMMAR_SPECS[kind].defaultPrefix);
    }
    const hierarchy = scanModelHierarchy(this.getSource?.() || "");
    const preferred = this.selectedParent || this.resolveActiveParentCandidate();
    const { defaultQualifiedName } = getLegalParentOptions(hierarchy, kind, preferred);
    this.selectedParent = defaultQualifiedName || "";
    this.render();
  }

  private buildPreviewString(legalOptions: ParentContainerOption[]): string {
    const name = this.customName.trim() || "identifier";
    const dir = this.selectedDirection ? `${this.selectedDirection} ` : "";
    const conj = this.conjugated && this.selectedType ? "~" : "";
    const typePart = this.selectedType ? ` : ${conj}${this.selectedType}` : "";
    let stmt = "";
    switch (this.selectedKind) {
      case "package":
        stmt = `package ${name} { … }`;
        break;
      case "part_def":
        stmt = `part def ${name} { … }`;
        break;
      case "port_def":
        stmt = `port def ${name};`;
        break;
      case "item_def":
        stmt = `item def ${name};`;
        break;
      case "requirement":
        stmt = `requirement ${name} { doc /* … */ }`;
        break;
      default:
        stmt = `${dir}${this.selectedKind} ${name}${typePart};`;
        break;
    }
    const parentOpt = legalOptions.find((o) => o.qualifiedName === this.selectedParent);
    const where = parentOpt
      ? parentOpt.qualifiedName === "__root__"
        ? "模型顶层"
        : parentOpt.qualifiedName
      : "无可用父容器";
    return `[${where}]  →  ${stmt}`;
  }

  private submitCreation(): void {
    const name = this.customName.trim();
    if (!IDENTIFIER_REGEX.test(name) || !this.selectedParent) {
      return;
    }
    const event: InsertElementEvent = {
      kind: this.selectedKind,
      name,
      targetParentId: this.selectedParent,
      typeName: this.selectedType || undefined,
      direction: this.selectedDirection || undefined,
      conjugated: this.selectedKind === "port" ? this.conjugated : undefined,
    };
    this.itemCounters[GRAMMAR_SPECS[this.selectedKind].defaultPrefix] =
      (this.itemCounters[GRAMMAR_SPECS[this.selectedKind].defaultPrefix] || 1) + 1;

    this.onInsert?.(event);

    if (this.keepOpen) {
      this.nameDirty = false;
      this.customName = this.generateUniqueName(GRAMMAR_SPECS[this.selectedKind].defaultPrefix);
      this.render();
      const input = this.popoverEl.querySelector<HTMLInputElement>("#palette-name-input");
      input?.focus();
      input?.select();
    } else {
      this.nameDirty = false;
      this.hide();
    }
  }

  private render(): void {
    this.popoverEl.replaceChildren();

    const src = this.getSource?.() || "";
    const hierarchy = scanModelHierarchy(src);
    const spec = GRAMMAR_SPECS[this.selectedKind];
    const { options: legalParents, defaultQualifiedName } = getLegalParentOptions(
      hierarchy,
      this.selectedKind,
      this.selectedParent || this.resolveActiveParentCandidate(),
    );
    if (!legalParents.some((o) => o.qualifiedName === this.selectedParent)) {
      this.selectedParent = defaultQualifiedName || "";
    }

    // Header
    const header = document.createElement("div");
    header.className = "popover-header";

    const title = document.createElement("span");
    title.className = "popover-title";
    title.textContent = "新建图元 · 父子层级与语法引导";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "popover-close-btn";
    closeBtn.textContent = "×";
    closeBtn.title = "关闭";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.hide();
    };

    header.append(title, closeBtn);
    this.popoverEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "popover-body palette-composer-body";
    body.onclick = (e) => e.stopPropagation();

    // 1. Element Kind Grid
    const kindSection = document.createElement("div");
    kindSection.className = "palette-field-group";
    const kindLabel = document.createElement("div");
    kindLabel.className = "palette-step-label";
    kindLabel.textContent = "1. 选择图元种类（也可直接拖拽至画布容器）";
    kindSection.appendChild(kindLabel);

    const kindGrid = document.createElement("div");
    kindGrid.className = "palette-kind-grid";

    for (const k of CREATABLE_KIND_ORDER) {
      const itemSpec = GRAMMAR_SPECS[k];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `palette-item-card ${this.selectedKind === k ? "active" : ""}`;
      btn.draggable = true;
      btn.title = itemSpec.grammarRuleHint;

      const badge = document.createElement("span");
      badge.className = "palette-item-badge";
      badge.textContent = itemSpec.badge;

      const lbl = document.createElement("span");
      lbl.className = "palette-item-label";
      lbl.textContent = itemSpec.label;

      btn.append(badge, lbl);
      btn.onclick = (e) => {
        e.stopPropagation();
        this.handleKindSelect(k);
      };
      btn.ondragstart = (e) => {
        e.dataTransfer?.setData(
          "application/sysml-item",
          JSON.stringify({ kind: k, defaultPrefix: itemSpec.defaultPrefix }),
        );
      };
      kindGrid.appendChild(btn);
    }
    kindSection.appendChild(kindGrid);
    body.appendChild(kindSection);

    // 2. Grammar-Enforced Parent Container Tree Selector
    const parentSection = document.createElement("div");
    parentSection.className = "palette-field-group";
    const parentLabel = document.createElement("label");
    parentLabel.className = "palette-step-label";
    parentLabel.htmlFor = "palette-parent-select";
    parentLabel.textContent = "2. 选择父级容器（已按 SysML v2 嵌套语法自动过滤）";
    parentSection.appendChild(parentLabel);

    const parentSelect = document.createElement("select");
    parentSelect.id = "palette-parent-select";
    parentSelect.className = "palette-form-select";

    if (legalParents.length === 0) {
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "⚠ 当前模型暂无合法父容器（请先创建包或部件）";
      parentSelect.appendChild(emptyOpt);
      parentSelect.disabled = true;
    } else {
      for (const opt of legalParents) {
        const optionEl = document.createElement("option");
        optionEl.value = opt.qualifiedName;
        optionEl.textContent = opt.displayLabel;
        optionEl.selected = opt.qualifiedName === this.selectedParent;
        parentSelect.appendChild(optionEl);
      }
    }

    const grammarHint = document.createElement("div");
    grammarHint.className = "palette-grammar-hint";
    grammarHint.textContent = spec.grammarRuleHint;

    parentSection.append(parentSelect, grammarHint);
    body.appendChild(parentSection);

    // 3. Name + Optional Type / Direction / Conjugation
    const detailSection = document.createElement("div");
    detailSection.className = "palette-field-group";
    const detailLabel = document.createElement("label");
    detailLabel.className = "palette-step-label";
    detailLabel.htmlFor = "palette-name-input";
    detailLabel.textContent = "3. 命名与类型特征";
    detailSection.appendChild(detailLabel);

    const nameRow = document.createElement("div");
    nameRow.className = "palette-input-row";

    const nameInput = document.createElement("input");
    nameInput.id = "palette-name-input";
    nameInput.type = "text";
    nameInput.className = "palette-form-input";
    nameInput.placeholder = "输入合法标识符，如 batteryPack";
    nameInput.value = this.customName;
    nameRow.appendChild(nameInput);

    // Optional Type dropdown
    let typeChoices: string[] = [];
    let typePlaceholder = "（不指定类型）";
    if (spec.supportsPartType) {
      typeChoices = hierarchy.partDefs;
      typePlaceholder = typeChoices.length ? "类型 :（可选 Part Def）" : "（暂无已定义 Part Def）";
    } else if (spec.supportsPortType) {
      typeChoices = hierarchy.portDefs;
      typePlaceholder = typeChoices.length ? "端口类型 :（可选 Port Def）" : "（暂无已定义 Port Def）";
    } else if (spec.supportsScalarType) {
      typeChoices = [...SCALAR_TYPES];
      typePlaceholder = "值类型 :（可选标量类型）";
    } else if (spec.supportsItemType) {
      typeChoices = [...hierarchy.itemDefs, ...SCALAR_TYPES];
      typePlaceholder = "载荷类型 :（可选类型）";
    }

    if (
      spec.supportsPartType ||
      spec.supportsPortType ||
      spec.supportsScalarType ||
      spec.supportsItemType
    ) {
      const typeSelect = document.createElement("select");
      typeSelect.id = "palette-type-select";
      typeSelect.className = "palette-form-select palette-type-select";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = typePlaceholder;
      typeSelect.appendChild(noneOpt);
      for (const t of typeChoices) {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = `: ${t}`;
        o.selected = t === this.selectedType;
        typeSelect.appendChild(o);
      }
      typeSelect.onchange = () => {
        this.selectedType = typeSelect.value;
        if (!this.selectedType) {
          this.conjugated = false;
        }
        this.render();
      };
      nameRow.appendChild(typeSelect);
    }

    detailSection.appendChild(nameRow);

    // Optional Direction & Conjugation row for Ports / Items
    if (spec.supportsDirection || spec.supportsConjugation) {
      const portExtraRow = document.createElement("div");
      portExtraRow.className = "palette-input-row palette-port-extra-row";

      if (spec.supportsDirection) {
        const dirSelect = document.createElement("select");
        dirSelect.id = "palette-dir-select";
        dirSelect.className = "palette-form-select";
        const dirs: Array<["" | "in" | "out" | "inout", string]> = [
          ["", "方向：无 (默认接口)"],
          ["in", "方向：in (输入 →)"],
          ["out", "方向：out (输出 →)"],
          ["inout", "方向：inout (双向 ↔)"],
        ];
        for (const [val, txt] of dirs) {
          const o = document.createElement("option");
          o.value = val;
          o.textContent = txt;
          o.selected = val === this.selectedDirection;
          dirSelect.appendChild(o);
        }
        dirSelect.onchange = () => {
          this.selectedDirection = dirSelect.value as "" | "in" | "out" | "inout";
          updateLiveState();
        };
        portExtraRow.appendChild(dirSelect);
      }

      if (spec.supportsConjugation) {
        const conjLabel = document.createElement("label");
        conjLabel.className = `palette-conj-toggle ${!this.selectedType ? "disabled" : ""}`;
        conjLabel.title = this.selectedType
          ? "共轭端口 (~PortDef)：自动反转接口定义内的 in/out 流向，用于配对互联"
          : "先选择右侧 Port Def 类型后可启用 ~ 共轭反转";

        const conjCheck = document.createElement("input");
        conjCheck.type = "checkbox";
        conjCheck.id = "palette-conj-input";
        conjCheck.checked = this.conjugated && Boolean(this.selectedType);
        conjCheck.disabled = !this.selectedType;
        conjCheck.onchange = () => {
          this.conjugated = conjCheck.checked;
          updateLiveState();
        };

        const conjSpan = document.createElement("span");
        conjSpan.textContent = "共轭反转 (~)";
        conjLabel.append(conjCheck, conjSpan);
        portExtraRow.appendChild(conjLabel);
      }

      detailSection.appendChild(portExtraRow);
    }

    const validationErr = document.createElement("div");
    validationErr.className = "palette-validation-err";
    validationErr.hidden = true;
    detailSection.appendChild(validationErr);

    body.appendChild(detailSection);

    // 4. Live SysML v2 Syntax Preview & Submit Footer
    const previewBox = document.createElement("div");
    previewBox.id = "palette-code-preview";
    previewBox.className = "palette-code-preview";

    const footerRow = document.createElement("div");
    footerRow.className = "palette-footer-row";

    const keepOpenLabel = document.createElement("label");
    keepOpenLabel.className = "palette-keep-open";
    const keepCheck = document.createElement("input");
    keepCheck.type = "checkbox";
    keepCheck.checked = this.keepOpen;
    keepCheck.onchange = () => {
      this.keepOpen = keepCheck.checked;
    };
    const keepSpan = document.createElement("span");
    keepSpan.textContent = "连续创建";
    keepOpenLabel.append(keepCheck, keepSpan);

    const submitBtn = document.createElement("button");
    submitBtn.id = "palette-submit-btn";
    submitBtn.type = "button";
    submitBtn.className = "tb-btn tb-btn-primary palette-submit-btn";
    submitBtn.textContent = "＋ 立即创建";
    submitBtn.onclick = (e) => {
      e.stopPropagation();
      this.submitCreation();
    };

    footerRow.append(keepOpenLabel, submitBtn);
    body.append(previewBox, footerRow);
    this.popoverEl.appendChild(body);

    const updateLiveState = () => {
      const trimmed = nameInput.value.trim();
      const validName = IDENTIFIER_REGEX.test(trimmed);
      if (!trimmed) {
        validationErr.hidden = false;
        validationErr.textContent = "请输入图元标识符名称";
      } else if (!validName) {
        validationErr.hidden = false;
        validationErr.textContent = "标识符须以字母或下划线开头，且仅含字母、数字与下划线";
      } else {
        validationErr.hidden = true;
      }
      submitBtn.disabled = !validName || legalParents.length === 0 || !this.selectedParent;
      previewBox.textContent = this.buildPreviewString(legalParents);
    };

    parentSelect.onchange = () => {
      this.selectedParent = parentSelect.value;
      updateLiveState();
    };

    nameInput.oninput = () => {
      this.customName = nameInput.value;
      this.nameDirty = true;
      updateLiveState();
    };

    nameInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!submitBtn.disabled) {
          this.submitCreation();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    };

    updateLiveState();
  }

  private setupCanvasDrop(): void {
    const mount = this.container.querySelector<HTMLElement>(".x6-graph-mount") || this.container;
    mount.addEventListener("dragover", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("application/sysml-item")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });

    mount.addEventListener("drop", (e) => {
      const raw = e.dataTransfer?.getData("application/sysml-item");
      if (!raw) return;
      e.preventDefault();

      try {
        const parsed = JSON.parse(raw);
        const kind = normalizeCreatableKind(parsed.kind || "part");
        const name = this.generateUniqueName(parsed.defaultPrefix || GRAMMAR_SPECS[kind].defaultPrefix);
        const localPt = this.graph.clientToLocal(e.clientX, e.clientY);

        // Detect deepest canvas container node under the drop point!
        const hierarchy = scanModelHierarchy(this.getSource?.() || "");
        let hoveredRef: string | undefined;
        const nodesUnderDrop = this.graph
          .getNodes()
          .filter((n) => {
            if (!n.isVisible()) return false;
            const b = n.getBBox();
            return (
              localPt.x >= b.x &&
              localPt.x <= b.x + b.width &&
              localPt.y >= b.y &&
              localPt.y <= b.y + b.height
            );
          })
          .sort((a, b) => (b.getZIndex() || 0) - (a.getZIndex() || 0));

        if (nodesUnderDrop.length > 0) {
          const vn = (nodesUnderDrop[0].getData() as { viewNode?: SysMLViewNode } | undefined)
            ?.viewNode;
          hoveredRef = vn?.qualifiedName || vn?.name;
        }

        const { defaultQualifiedName } = getLegalParentOptions(
          hierarchy,
          kind,
          hoveredRef || this.resolveActiveParentCandidate(),
        );

        this.hide();
        this.onInsert?.({
          kind,
          name,
          targetParentId: defaultQualifiedName,
          position: { x: Math.round(localPt.x), y: Math.round(localPt.y) },
        });
      } catch (err) {
        console.warn("Drop item parse error:", err);
      }
    });
  }

  public dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("click", this.outsideClickListener);
    }
    this.popoverEl.replaceChildren();
    this.popoverEl.hidden = true;
  }
}
