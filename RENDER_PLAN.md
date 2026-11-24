# SysML Workbench 渲染引擎与工业 CAD 级交互式画布执行计划 (`RENDER_PLAN.md`)

> **执行会话交接说明**：本计划已与用户完整对齐定稿，专供后续开发会话直接按里程碑（`Milestone R1` $\rightarrow$ `R4`）逐步落地执行。开始编码前请先完整阅读本文件。

---

## 一、 工程环境与红线守则（必读）

1. **仓库与分支规范**：
   - 本地目录：`C:\Users\gjy\Documents\ChatGPT\sysml\sysml-workspace`
   - 远端仓库：`git@github-huai:huai-Guo/sysml-workspace.git`（优先使用 SSH Host `github-huai`）
   - 当前开发分支：**`feat/interactive-canvas`**（基于 `main` `23f69f0` 切出）
   - 科研复现分支：`research/thesis-agent`（已独立保存硕士论文计划 `RESEARCH_PLAN.md`）
   - **合并红线**：**所有的 `merge`（尤其是合并回 `main`）必须经用户明确同意，未经许可严禁自动合并！**
2. **前后端技术栈与构建验证命令**：
   - **前端**：原生 TypeScript（**无 React / Vue 框架**）+ CodeMirror 6 + `esbuild` 打包至后端静态目录。
     - 安装与检查：`cd frontend && npm install && npm run typecheck && npm test && npm run build`
   - **后端**：Python 3.12 (`backend/.venv`) + FastAPI + SQLite + OMG SysML v2 Pilot `0.62.0` JVM（Java 21）。
     - 测试命令：`cd backend && .venv\Scripts\pytest`

---

## 二、 现存渲染不可用的代码级根因定位（改造切入点）

执行会话无需重新全局摸底，现存代码问题与可复用资产精确位置如下：

1. **待替换的旧死图链路**：
   - `backend/src/sysml_workspace/server/local_executor.py`（第 109–123 行）：目前直接调用简陋的 `backend/src/sysml_workspace/diagram/svg.py` 拼接静态 SVG 字符串，把所有 `ownership` 画成横跨全图的实线，所有元素画成无差别的白框。
   - `backend/src/sysml_workspace/server/static/index.html`（第 269–300 行）与 `frontend/src/results.ts`（第 437–469 行）：目前将 SVG 转为 Blob URL 塞进 `<img id="diagram-image">`，完全没有交互式画布节点与图形对象模型。
2. **可直接盘活并升级的已有原型资产**：
   - `backend/src/sysml_workspace/diagram/prototype/` 下已存在未接通主链路的原型代码：
     - `graph_ir.py` / `projection.py`（基础语义图投影骨架，需修正包内相对导入为包限定导入并升级为多视图富语义 `ViewIR`）；
     - `semantic_commands.py` / `connection_editing.py`（画布编辑反向编译为 `.sysml` 文本的命令编译器，可直接扩展支持新增元素、连线、重命名）；
     - `reference_integrity.py`（删除元素前的引用安全审计）。
   - `backend/tooling/sysml-validator/.../ValidatorMain.java`：已导出包含 `entities`（`id`, `kind`, `name`, `qualified_name`, `owner_id`, `location`, `types`, `chaining_features`, `direction`）与 `relations` 的完整语义 JSON。

---

## 三、 核心架构与技术选型决策（已定稿）

### 1. 设计目标融合矩阵（MBSE × Draw.io × 工业 CAD/EDA）
结合 **Eclipse SysON**（多视图与动态隔间）、**OMG PlantUML**（标准 SysML v2 图形符号）、**Draw.io**（自由拖拽缩放与 `.drawio` 互通）以及 **AutoCAD / EPLAN / KiCad**（原理图管脚、正交跨线桥弧、标尺捕捉、多图层治理、ISO 标准工程图框与 `.dxf` 导出）：

- **前端渲染与排版依赖**：引入 **`@antv/x6`**（交互式矢量图编辑引擎，原生 TS 零框架绑定，完美兼容现有 `esbuild`）+ **`elkjs`**（Eclipse SysON 同款分层复合容器与端口正交自动布线引擎）。
- **模型与布局解耦（Model-Layout Separation）**：`.sysml` 源码始终作为唯一语义真值（SSOT）；所有人工微调的节点 `(x, y, width, height)`、连线折点 `vertices`、隔间折叠态与图层配置均以元素稳定的 **`qualified_name`** 为键存储在会话关联的 `LayoutSidecar`（本地缓存与后端 SQLite 会话状态）中——**改代码重跑绝不丢失人工排好的位置**。

### 2. 三套专业制图皮肤与工作台主题联动策略（已确认“全内置 + 智能联动”）
同时内置以下三套制图皮肤，并在画布工具栏提供切换菜单（`跟随工作台主题 [默认]` / 固定锁定某皮肤）：
1. **`CAD Dark Blueprint`（暗黑工程蓝图风 — 工作台暗色模式默认激活）**：
   - 深空蓝黑制图底色（`#0d1219`）+ 双级自适应十字/点阵坐标网格；
   - 锋利工程线条：定义框采用青白高亮实线，电源/能量流采用琥珀色，信号/数据流采用亮青色，需求满足线采用品红虚线。
2. **`SysON Clean`（现代清爽亮色风 — 工作台亮色模式默认激活）**：
   - 浅灰白底色 + 现代高对比度语义色标卡片，与亮色代码编辑器自然一体。
3. **`ISO Technical Drawing`（国标/ISO 工程白图风 — 一键切换供论文插图/工程出图）**：
   - 纯白图纸底 + 严格黑白灰 ISO 128 技术制图线宽等级（主轮廓 `1.5px` 粗实线、隔间分隔 `0.75px` 细实线）；
   - 支持开启 **外围标准工程图框（含 `A–F` / `1–8` 图幅分区坐标标尺 + 右下角参数化标题栏 Title Block：自动展示根包名、视图类型、构件数量、SHA-256 指纹与日期）**。

---

## 四、 前后端数据契约规范（`ViewIR v2` & `LayoutSidecar`）

### 1. 后端投影输出契约（`ViewIR v2`）
支持 4 种标准视图模式（`view_type`: `"general"` | `"interconnection"` | `"state"` | `"requirements"`）：

```ts
export interface SysMLViewIR {
  schemaVersion: "2.0";
  sourceSha256: string;
  rootPackageName: string;
  viewType: "general" | "interconnection" | "state" | "requirements";
  nodes: SysMLViewNode[];
  edges: SysMLViewEdge[];
  summary: { displayedNodes: number; displayedEdges: number; omittedElements: number };
}

export interface SysMLViewNode {
  id: string;                     // 稳定锚点：优先采用 qualified_name
  semanticId: string;             // Pilot 导出实体 ID (e0, e1...)
  qualifiedName: string;
  name: string;
  kind: string;                   // PartDefinition, PartUsage, Package, StateUsage, RequirementUsage...
  shapeCategory: "definition" | "usage" | "package" | "state" | "action" | "requirement" | "constraint";
  stereotype: string;             // 如 "«part def»", "«part»", "«state»", "«requirement»"
  typeLabel?: string;             // 如 ": PowerSubsystem [2]"
  parentId?: string | null;       // 容器嵌套父节点 ID（替代旧版满屏乱飞的 ownership 连线！）
  layer: "L1_Definitions" | "L2_Structure" | "L5_Requirements";
  compartments: {
    id: "attributes" | "ports" | "parts" | "constraints" | "actions" | "doc";
    title: string;
    items: { id: string; text: string; line?: number }[];
  }[];                            // 空隔间不输出或默认隐藏
  ports: {
    id: string;                   // qualified_name
    name: string;
    typeName?: string;
    direction?: "in" | "out" | "inout" | null;
    conjugated: boolean;          // 是否为 ~Port 共轭端口
    sideHint?: "N" | "S" | "E" | "W";
    line?: number;
  }[];
  sourceLocation?: { line: number; offset: number; length: number };
}

export interface SysMLViewEdge {
  id: string;
  kind: "specialization" | "composition" | "connection" | "flow" | "transition" | "satisfy" | "verify" | "dependency";
  sourceId: string;
  sourcePortId?: string;
  targetId: string;
  targetPortId?: string;
  label?: string;                 // 如流类型、状态转移 "accept cmd [ok] / act" 或 "«satisfy»"
  layer: "L1_Definitions" | "L4_Connections" | "L5_Requirements";
  sourceLocation?: { line: number; offset: number; length: number };
}
```

---

## 五、 分阶段实施路线图（Milestone R1 – R4）

> **执行建议**：请按 `R1 -> R2 -> R3 -> R4` 顺序分阶段提交（Commit），每完成一个里程碑确保 `npm run typecheck && npm test && npm run build` 与后端 `pytest` 全部通过。

---

### Milestone R1：多视图富语义投影 + `elkjs` 正交排版 + 三皮肤交互画布底座
- [x] **R1.1 后端多视图 `ViewIR v2` 投影引擎**：
  - 在 `backend/src/sysml_workspace/diagram/` 下建立正式的 `view_ir.py` 与多视图投影器（吸收并规整 `prototype/` 代码），将父子 `ownership` 转化为 **容器嵌套（Interconnection/State 视图）** 或 **分栏隔间（General 视图）**，提取端口方向 `in/out` 与共轭 `~` 信息；
  - 更新 `local_executor.py` 与相关渲染 API，同时返回 `view_ir`（保留旧 `svg` 字段兼容降级，主界面全面切至 `view_ir`）。
- [x] **R1.2 前端 `@antv/x6` + `elkjs` 交互画布挂载**：
  - 在 `frontend/` 安装 `@antv/x6` 与 `elkjs`，新建模块化目录 `frontend/src/canvas/`（`engine.ts`, `elk_layout.ts`, `shapes.ts`, `themes.ts`, `sidecar.ts`）；
  - 改造 `index.html` 与 `results.ts`：用交互式画布挂载点替代死图片 `<img id="diagram-image">`，实现 **OMG 标准图形符号区分**（`Definition` 直角框、`Usage` 圆角框、`Package` 折耳框、可折叠隔间、EPLAN 原理图式带引出短线与极性箭头的边界管脚 `Port`）；
  - 配置正交路由（`manhattan`/`orth`）与 **交叉线自动跨线桥弧 `⌒`（`jumpover` 连接器）**；
  - 实装四大视图切换器、**三套制图皮肤（含跟随工作台主题自动切换 + ISO 标准工程图框标题栏渲染）**、鼠标滚轮光标中心缩放、中键/空格平移、单击图元联动高亮左侧 CodeMirror 6 对应源码行，以及基于 `qualified_name` 的 `LayoutSidecar` 增量布局记忆。
- **R1 验收标准**：打开默认示例或任意复杂 SysML v2 模型，可切换 4 种视图与 3 套皮肤，节点无重叠、端口贴边正交连线带跨线跳弧，可自由拖拽节点/调整大小且重新编译刷新后手工位置不丢失。

---

### Milestone R2：工业 CAD 精度控制体系 + Draw.io 级编辑与代码反向同步
- [x] **R2.1 CAD 精度辅助与图层系统**：
  - 实现画布顶部与左侧 **动态工程刻度标尺（Zoom-Adaptive Rulers）** 与底部 **CAD 精度状态栏**（实时光标世界坐标 `X, Y`、缩放比、`GRID` 网格、`SNAP` 栅格吸附、`OSNAP` 管脚/中点捕捉、`F8 ORTHO` 正交走线锁定、`SHEET` 图框开关）；
  - 实现 AutoCAD 经典框选区分：**从左向右拖出实线蓝框（全包含才选中）vs 从右向左拖出虚线绿框（碰边即选中）**；
  - 实现右侧可折叠 **CAD 图层与数值属性面板**：支持 `L0~L5` 六个语义图层独立显隐（👁）与防误触锁定（🔒），支持直接输入精确数字修改选中节点的 `X, Y, W, H`；
  - 接入对齐辅助线（Snapline）、正交连线中段/拐点自由拖拽、`Ctrl+Z / Ctrl+Y` 撤销重做、对齐/等距分布工具与右下角小地图（Minimap）。
- [x] **R2.2 画布到 `.sysml` 代码反向语义编辑**：
  - 实现左侧可收起 **SysML v2 标准元件库（Palette）**：支持拖拽新建 `Package`、`Part Def`、`Part`、`Port`、`State`、`Requirement` 到画布或父容器内；
  - 支持从源端口磁吸靶拖出连线至目标端口（自动生成 `connection` / `transition` / `satisfy`）、双击节点原地改名、按 `Delete` 安全删除（联动后端 `SemanticCommandCompiler` 与 `reference_integrity` 校验后精准更新编辑器 `.sysml` 源码）。
- **R2 验收标准**：图层显隐/锁定、数值坐标定位、撤销重做均正常工作；在画布拖入部件并连端口后，左侧 CodeMirror 6 源码实时合法更新并通过 Pilot 编译。

---

### Milestone R3：全格式“导入 + 导出（含 AutoCAD `.dxf` 与 `.drawio` 互通）”中心
- [x] **R3.1 五格式专业导出器（`frontend/src/canvas/exporters/`）**：
  1. **导出 `.dxf`（AutoCAD 工程图纸）**：生成标准 ASCII R2000 DXF，将 `L0~L5` 语义图层映射为原生 CAD `LAYER` 表，将容器框、隔间线、管脚、正交折线、跨线圆弧与图框标题栏输出为精确 `LWPOLYLINE`、`LINE`、`ARC`、`MTEXT` 图元（确保 AutoCAD / 浩辰 / 中望 / LibreCAD 可直接分层打开编辑）；
  2. **导出 `.drawio` 可编辑文件**：生成标准未压缩 `<mxfile>` XML（内嵌 `sysmlSource` 与 `qualifiedName` 元数据以支持无损导回），可在桌面版/网页版 Draw.io 直接打开编辑；
  3. **导出 `.sysmlwb.json` 工作台工程包** 与 **纯净 `.sysml` 代码文件**；
  4. **导出出版级高清图片 `.png`**（支持 `1x / 2x / 4x` 超采样倍率、白底/透明底/蓝图底、可选是否包含外围 ISO 工程图框，满足 300+ DPI 论文印刷需求）；
  5. **导出独立矢量图 `.svg`**（内联样式与可恢复 `<metadata>` 快照）。
- [x] **R3.2 四模式导入器（`frontend/src/canvas/importers/`，支持按钮选择与窗口拖拽放入）**：
  1. 导入 `.sysml` / `.kerml` 源码自动编译布线；
  2. 导入 `.sysmlwb.json` 像素级无损恢复源码与全部手工布局、折点及图层状态；
  3. 导入 `.drawio` / `.xml`：① 若含本平台元数据则无损恢复源码并同步用户在外部 Draw.io 新调好的坐标；② 若为外部手画普通嵌套框图，自动解析父子矩形、贴边小块与连线，逆向编译生成合法初始 `.sysml` 骨架代码！
  4. 拖回本平台导出的 `.svg` 自动解析 `<metadata>` 恢复完整可编辑工程。
- **R3 验收标准**：所有导出格式均可生成非空合规文件；`.sysmlwb.json`、`.drawio` 与 `.svg` 往返导入零坐标丢失，外部手绘简单 `.drawio` 框图导入可成功生成对应 `.sysml` 代码。

---

### Milestone R4：命令快捷栏、大节点性能优化与自动化测试收口
- [ ] **R4.1 CAD 快捷命令唤醒栏**：支持快捷键（如空格/`/` 呼出轻量命令框执行 `FIT`, `ORTHO`, `GRID`, `ALIGN L/R/T/B`, `EXPORT DXF/PNG/DRAWIO`, `LAYOUT`）。
- [ ] **R4.2 性能与边界打磨**：确保 100+ 节点模型缩放平移保持流畅帧率；完善编译报错态下的“保留上一版有效视图并叠加陈旧提示（Stale Overlay）”体验（避免用户打字中途语法未闭合导致画布闪烁清空！）。
- [ ] **R4.3 全量测试覆盖**：补充后端 `ViewIR` 多视图投影与反向命令单元测试，补充前端 `.dxf` / `.drawio` 编解码、增量布局合并与状态管理单测，确保构建产物干净零警告。
