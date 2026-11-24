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
- [x] **R4.1 CAD 快捷命令唤醒栏**：支持快捷键（如空格/`/` 呼出轻量命令框执行 `FIT`, `ORTHO`, `GRID`, `ALIGN L/R/T/B`, `EXPORT DXF/PNG/DRAWIO`, `LAYOUT`）。
- [x] **R4.2 性能与边界打磨**：确保 100+ 节点模型缩放平移保持流畅帧率；完善编译报错态下的“保留上一版有效视图并叠加陈旧提示（Stale Overlay）”体验（避免用户打字中途语法未闭合导致画布闪烁清空！）。
- [x] **R4.3 全量测试覆盖**：补充后端 `ViewIR` 多视图投影与反向命令单元测试，补充前端 `.dxf` / `.drawio` 编解码、增量布局合并与状态管理单测，确保构建产物干净零警告。

---

### Milestone R5（架构纠偏重塑）：砍除伪 CAD 机械累赘 + 专攻“真·大图套小图嵌套/下钻”与“多比例尺语义缩放适配（LOD）”

> **设计理念纠偏**：SysML 是**抽象逻辑与拓扑架构建模**，而非物理几何尺寸量化 CAD。必须彻底清除横纵像素标尺、`X/Y` 坐标读数、机械图纸框与侵占分屏空间的常驻悬浮面板，将 100% 视觉重心聚焦在 **复合层级嵌套（大图套小图）** 与 **跨缩放比例尺的清晰可读性（Semantic Zoom LOD）** 上。

- [ ] **R5.1 界面彻底减法瘦身（归还 100% 纯净通透视口）**：
  - 移除并解耦 `rulers.ts`（顶部/左侧像素刻度尺与红线准星）、`status_bar.ts`（`X/Y` 像素坐标与 `SNAP/OSNAP/ORTHO/SHEET` 按钮排）、`command_bar.ts`（`/` 命令浮窗）、`exporters/dxf_exporter.ts`（机械 DXF 导出）以及外围 `A–F / 1–8` 机械图纸框；
  - 取消默认展开占据左右两侧 `180px + 240px` 的常驻悬浮大面板：新建图元与元素过滤精简合并为顶部工具栏按需弹出的紧凑下拉浮层（Popover，删除无意义的 `X/Y/W/H` 数值坐标输入框，点击画布空白自动收起）；
  - 正交路由、跨线跳弧 `⌒`、对齐参考线默认后台静默开启；画布仅在右下角保留一个极简半透明缩放胶囊（`−` | `100%` | `＋` | `适应窗口`）；皮肤精简为**暗色深邃蓝图（随暗色主题）**、**现代清爽亮色（随亮色主题）**与**论文纯净黑白印刷风（无机械外图框）**。
- [ ] **R5.2 真·大图套小图（消除穿模 + 动态边界包络 + 折叠与面包屑下钻）**：
  - **复合容器专属布局（根治父框文字与子图重叠穿模）**：区分叶子节点与含子节点的复合容器（Compound Container）；移除 `elk_layout.ts` 对父容器 `Math.min(360, width)` 的宽度封顶，按 `topPadding = 标题栏高度 + 父级属性横栏高度 + 20px` 精确传入 `elk.padding`，确保内部子图严格排布在父容器头部与属性区下方的独立通透腔体（Cavity，按嵌套深度 `depth` 递进微调底色明度并严格设置 `zIndex = 1 + depth * 2`）内，零文字穿模；
  - **父子动态边界包络（Auto-Fit Parent Bounds）**：在父容器内拖动或缩放子节点时，自动重算并平滑撑大/更新父容器（及祖先容器）包围盒，防止小图悬空脱出大图边界；
  - **子图白盒/黑盒一键折叠 + 双击面包屑下钻（Drill-Down）**：复合容器标题栏右侧提供 `[-]/[+]` 折叠开关（折叠后收拢内部子孙节点并将跨边界连线临时收束至父容器边缘）与 `⤢` 下钻按钮（或双击父容器标题独立聚焦渲染该子系统内部视图，左上角浮现轻量面包屑 `全局 > 父系统 > 子模块` 一键返回上级大图）。
- [ ] **R5.3 多比例尺语义缩放适配（3-Tier Semantic Zoom LOD & 视口自适应）**：
  - **三级语义 LOD（监听 `scale` 并经 `requestAnimationFrame` 节流）**：
    1. *宏观鸟瞰态（`scale < 0.55`）*：自动隐藏细碎隔间条目、次要边标签与长端口类型后缀，对模块主标题实施反比例字号放大补偿（如 `Math.min(26, 13 / Math.max(scale, 0.3))`）与主框线/主连线屏幕线宽补偿，并将背景网格切为大步长稀疏弱网格——确保缩放到 `30%~50%` 看全局大图时模块名与主干依然字正腔圆、无黑点噪点；
    2. *中观标准态（`0.55 <= scale <= 1.25`）*：标准字号线宽，展示构造型、标题、端口短名与核心隔间；
    3. *微观详尽态（`scale > 1.25`）*：完整展示端口极性/类型签名、完整约束与状态动作细节；
  - **分屏尺寸变化自适应**：通过防抖 `ResizeObserver` 监听分屏拖拽宽度变化，在未手动拖动锁死局部特写时自动平滑居中 `zoomToFit` 适配当前视口比例。
- **R5 验收标准**：打开画布清爽无任何标尺/坐标/常驻侧栏遮挡；多层级模型“大图套小图”层次分明零穿模，拖小图大图自动包裹，支持一键黑盒折叠与双击面包屑下钻；从 `30%` 缩放到 `200%` 全程文字与线条清晰适配；前后端测试与打包全绿。
