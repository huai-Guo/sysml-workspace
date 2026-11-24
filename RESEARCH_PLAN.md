# SysML Workbench 硕士论文科研复现与分阶段实施计划 (`RESEARCH_PLAN.md`)

> **文档定位**：本文件是 `research/thesis-agent` 科研分支的根目录总控纲领（对标**南京大学软件工程硕士学位论文盲审优/良标准**定稿）。所有设计均已完成底层字节码与现有源码级可落地性核验，**零外部重型软件依赖、零显卡微调依赖、纯确定性程序分析与现有技术栈闭环实现**，严格按阶段推进、逐阶段停靠验收。

---

## 一、 分支治理与“生产 / 科研”双轨隔离规范

1. **双分支职责隔离**：
   - **`main` 分支（生产稳定轨）**：保留面向日常建模使用的纯净版 `SysML Workbench` 工作台与基础 Agent（锚定 `23f69f0`），不混入批量评测脚本或实验中间产物。
   - **`research/thesis-agent` 分支（科研复现轨）**：承载硕士学位论文全套数据集处理、`B1~B6` 六大基线同构复现、开放式编码根因分析、基于静态程序分析与语义图审查的科研版 Agent（`ThesisAgent`）、消融实验及工作台双模回接代码。
2. **Git 与远端铁律**：
   - 远端推送统一优先使用 SSH Host：`git@github-huai:huai-Guo/sysml-workspace.git`。
   - **严禁任何未经用户明确同意的自动 `merge`**（尤其是将科研分支合并回 `main`）。
3. **代码级基线保护原则**：
   - 现有 `backend/src/sysml_workspace/agent/workflow.py` 中的 `generate -> validate -> repair` 全量重写工作流**原样保留冻结**，直接作为受控对比实验中的标准 **Baseline 4（Vanilla GCR）**。
   - 科研新增的评测器、静态分析切片算法与改进版 Agent 统一组织在独立的 `research/` 目录下；重型推理轨迹落盘至被 `.gitignore` 忽略的 `local_data/research_runs/`。

---

## 二、 核心研发顺序与可落地性保障（底层已核验清单）

本计划拒绝任何“纸面画饼”，所有核心技术点均已对照本地源码与 JAR 字节码确认 **100% 可用纯 Python + 现有 Java 21 + 现有前端栈落地**：

| 核心升级项（支撑南大盲审算法与系统深度） | 底层源码可落地性依据（已实查验证） | 预计核心代码量 |
| :--- | :--- | :---: |
| **1. 常驻毫秒级校验与报错态局部 AST 导出** | 已通过 `javap -c` 核验 `SysMLInteractive.class` 字节码：改调公开方法链 `next(".sysml") -> parse() -> validate() -> getRootElement() -> exportModel() -> finally { removeResource() }`，既解决报错态提前清空 AST 问题，又实现常驻内存跨请求零污染隔离。 | ~70 行 Java + ~120 行 Python |
| **2. $k$-阶逆向语义依赖程序切片修复算法** | `ValidatorMain.java` 已原生导出 `entities`（含 `types`、`chaining_features`、`direction`、`offset/length`）与 `relations` JSON；直接在该有向图上运行纯 Python BFS 逆向依赖闭包切片（外加 60 行花括号栈兜底切分器）。 | ~180 行纯 Python |
| **3. 需求-架构二部图最大匹配与可达性静态分析** | 基于前置结构化需求核对单与 `ValidatorMain` / `projection.py` 导出的语义图，使用纯 Python 匈牙利算法（二部图最大权匹配）算覆盖率，用 DFS/Tarjan 强连通分量检测不可达状态、死锁状态与悬挂端口。 | ~220 行纯 Python |
| **4. 传统 + 2025–2026 前沿六大对比基线 (`B1~B6`)** | `B5 (Chunk-RAG + GCR)` 直接复用现有 `sysml_workspace.knowledge` 固定分块检索器拼原 `workflow.py`；`B6 (Task-Decomposed MAS)` 直接用已安装的 `langgraph>=1.2.12` 搭三节点任务分解生成流，无需额外第三方框架。 | ~170 行纯 Python |
| **5. IDE 诊断延迟压测与画布布局稳定性评测** | 现有 `layout.py`（`SimpleHierarchicalLayout`）已对每个节点输出确定性 `(x, y, width, height)`；修订前后直接对比未变更节点的语义 ID 存活率与坐标偏移均值 $\Delta_{\text{pos}}$，无需重写前端排版引擎。 | ~80 行纯 Python |

---

## 三、 科研目录结构规划

```text
sysml-workspace/
├── RESEARCH_PLAN.md                 # 本分阶段实施计划与进度看板（根目录）
├── backend/                         # 既有后端与 OMG SysML v2 Pilot 0.62.0 验证器
├── frontend/                        # 既有 TypeScript + CodeMirror 6 三模态工作台前端
├── research/                        # 【科研分支专属目录：一键复现论文全部实验】
│   ├── README.md                    # 实验复现说明与命令手册
│   ├── datasets/                    # 数据集清单、真值兼容性核验与三切分索引
│   │   ├── pool0_syntax_cards/      # 官方基础语法参考片段（仅作检索源，严禁入评测集）
│   │   ├── split1_diagnostic_dev/   # 官方示例逆向合成与防背诵重命名诊断开发集（开放分析）
│   │   └── split2_blind_test/       # 封存盲测集（SysMBench 151条英文集 + Revise 演化子集）
│   ├── harness/                     # 守护验证客户端、确定性指标计算器与显著性检验（Wilcoxon/McNemar）
│   ├── baselines/                   # 六大受控对比基线（B1~B4 基础基线 + B5 Chunk-RAG + B6 Decomposed-MAS）
│   ├── taxonomy/                    # Stage 3 开放式编码工具、编码本（Codebook）、Cohen's κ 计算与根因统计
│   ├── thesis_agent/                # Stage 4 逆向语义依赖切片修复 + 二部图契约与可达性静态审查 Agent
│   └── reports/                     # Stage 5/6 自动汇总生成的论文三线表（CSV/LaTeX）与趋势图脚本
└── local_data/
    └── research_runs/               # 原始推理轨迹 JSONL 与候选快照（本地留档，已被 .gitignore 忽略）
```

---

## 四、 分阶段执行蓝图与停靠验收门禁（Stage 0 – Stage 6）

> **执行约定**：严格遵循 **“准备基础设施与数据 $\rightarrow$ 测基线拿真实错例 $\rightarrow$ 编码分析导出分类与 RQ $\rightarrow$ 开发靶向算法模块 $\rightarrow$ 开盲测集汇总与系统回接”** 顺序。每完成一个阶段在 **🛑 停靠验收门禁（Stop Gate）** 处暂停汇报，经确认后再推进下一阶段。

---

### Stage 0：验证器科研级底层加固（常驻内存加速 + 报错态局部 AST 导出）
- **当前状态**：`[ ] 待启动`
- **阶段目标**：消除每次校验冷启动 JVM 重载 97 个标准库文件的数秒开销，并让验证器在 `valid == false` 时依然导出已解析的局部 AST 实体位置与依赖图，支撑后续逆向依赖切片算法。
- **具体任务**：
  - [ ] **0.1 常驻守护模式（`--daemon`）与公开解析链重构**：在 `ValidatorMain.java` 中采用 `next(".sysml") -> parse() -> validate() -> getRootElement() -> exportModel() -> finally { removeResource() }` 流程支持 JSON Lines 常驻流处理，并在 `valid == false` 且 `root != null` 时输出 `partial_model`。
  - [ ] **0.2 Python 守护进程客户端与自动重启容错**：实现 `WarmPilotValidator`（崩溃或超时自动拉起新守护进程），并在 `research/harness/lexical_slicer.py` 实现花括号栈词法块边界兜底切分器（应对括号未闭合的极端语法错误）。
  - [ ] **0.3 等价性与 P50/P95 延迟基准测试**：验证守护模式与原单次子进程模式在 20+ 正负样本上的诊断码、AST 输出 100% 一致，同时产出论文第 5 章所需的冷热启动延迟对比实测数据。
- **🛑 停靠验收门禁（Gate 0）**：后端现有测试全过；新旧验证器输出 100% 等价；单次校验耗时降至百毫秒级以内。**汇报实测加速比数据后暂停，等待指令进入 Stage 1。**

---

### Stage 1：全英文双基准数据集构建、真值版本核验与三切分封存
- **当前状态**：`[ ] 待启动`
- **前置条件**：Stage 0 验收通过。
- **阶段目标**：构建全英文、无记忆泄露、物理三切分隔离的数据体系，并提前完成真值模型在 `Pilot 0.62.0` 下的语法兼容性体检。
- **具体任务**：
  - [ ] **1.1 外部盲测集拉取、真值体检与封存（`Split 2A: SysMBench`）**：获取 `SysMBench` 151 条英文样本；用 `WarmPilotValidator` 检验其自带参考真值模型在 `0.62.0` 下的静态解析率（对旧版语法真值建立只读兼容解析映射以确保 `DiagramIR` 真值图提取完整，原测试题面一字不改），随后打上封存锁（严禁开发期人工查看模型在其上的报错）。
  - [ ] **1.2 官方库准入筛查与分池（`Pool 0` vs `Split 1` 候选）**：批量校验官方 `Systems-Modeling/SysML-v2-Release (2026-08)` 样本，将基础短语法示例归入 `Pool 0`（语法参考池），将有效 AST 实体数 $\ge 6$ 且含端口/连接/状态/需求关系的完整模型归入 `Split 1` 候选池（物理零重叠）。
  - [ ] **1.3 防记忆污染同构重命名与异源英文需求逆向合成（`Split 1` & `Split 2B`）**：对知名官方案例执行 AST 保构标识符/场景替换（复验 `Pilot valid == true`），调用**异源模型**逆向生成纯业务英文需求（禁含代码关键字），构建约 120~150 条 `Split 1` 诊断开发集，以及 30~35 条面向已有合法模型的局部变更盲测子集（`Split 2B: Revise`）。
  - [ ] **1.4 多维确定性评测器与统计检验模块**：在 `research/harness/` 实现编译指标、`DiagramIR` 图拓扑匹配 F1、`SimpleHierarchicalLayout` 布局稳定率、`CodeBLEU`、异源裁判 `SysMEval` 接口，以及 **Wilcoxon 符号秩检验 / Cliff's $\delta$ / McNemar 显著性检验** 计算器。
- **🛑 停靠验收门禁（Gate 1）**：汇报各分片精确样本统计、`SysMBench` 真值体检结果，并抽样展示 `Split 1` 英文需求-真值对供人工核验。**确认合格后进入 Stage 2。**

---

### Stage 2：诊断开发集（Split 1）六大对比基线（B1–B6）同构运行与轨迹采集
- **当前状态**：`[ ] 待启动`
- **前置条件**：Stage 1 验收通过。
- **阶段目标**：冻结现有模型（`glm-5.3`, `temperature=0`）与 `Pilot 0.62.0`，在 `Split 1` 上跑通涵盖传统提示与 2025–2026 前沿范式的六大基线，采集真实失效轨迹。
- **具体任务**：
  - [ ] **2.1 六大受控基线实现**：
    - `B1: Direct Zero-Shot`（零样本直接生成）
    - `B2: Few-Shot ICL`（来自 `Pool 0` 的固定示例引导）
    - `B3: Grammar-Guided CoT`（SysML v2 核心语法规则提示 + 思维链）
    - `B4: Vanilla GCR`（直接复用冻结的 `sysml_workspace.agent.workflow` 全量重写修复循环）
    - `B5: Chunk-RAG + GCR`（复用 `sysml_workspace.knowledge` 固定文本分块检索 `Pool 0` Top-3 + 全量修复，对标 *Olivert-Iserte 2026*）
    - `B6: Task-Decomposed MAS`（基于 `LangGraph` 实现无全局契约锁定的任务分解生成 + 全量修复，对标常规多智能体范式）
  - [ ] **2.2 10 条样本冒烟试跑与成本核算**：核验六大基线单样本平均耗时与 Token 消耗账单。
  - [ ] **2.3 `Split 1` 全量运行与轨迹落盘**：落盘全部候选源码、诊断码、修复轨迹 Diff 与图结构初评分数。
- **🛑 停靠验收门禁（Gate 2）**：先汇报 10 条冒烟成本；全量完成后汇报 `Split 1` 上 `B1~B6` 的初始表现对比表。**确认后进入 Stage 3 数据挖掘。**

---

### Stage 3：开放式编码根因分析、双人一致性校验与 RQs / 算法规格锁定（论文第 3 章前半）
- **当前状态**：`[ ] 待启动`
- **前置条件**：Stage 2 数据采集完成。
- **阶段目标**：严格依据 *ICSE 2024/2025* 实证规程从 `Split 1` 真实错例中归纳出 **SysML v2 生成错误根因分类树**，彻底杜绝拍脑袋预设，用真实数据占比锁定 Stage 4 的具体算法模块。
- **具体任务**：
  - [ ] **3.1 自动化客观表象分桶**：将失败与低分样本自动聚入“编译报错桶（按 `Issue.kind` + `Issue.code`）”、“多轮修复退化/删减桶（AST Diff）”与“编译通过但拓扑残缺桶（低 Recall）”。
  - [ ] **3.2 最小手工修复与开放式编码（Open Coding）**：分层抽样执行 Minimal Manual Fix，归纳建立包含“形式化定义 + 违反的 SysML v2 语法规定条款 + 正反例”的 **编码本（Codebook）**，绘制理论饱和度曲线。
  - [ ] **3.3 一致性检验支持**：生成 20% 随机样本盲标表格与 **Cohen's $\kappa$** 自动核算脚本。
  - [ ] **3.4 定稿 RQs 与核心算法规格书**：根据排名最高的真实根因占比，正式定稿论文 4 个 RQs 与 Stage 4 两大核心算法的输入输出形式化定义。
- **🛑 停靠验收门禁（Gate 3 · 核心科研决策门）**：交付《`Split 1` 错误根因实证统计报告与 Codebook》及《靶向算法与 Agent 详细设计书》。**经你审阅拍板后启动 Stage 4。**

---

### Stage 4：程序依赖切片修复与语义图静态分析 Agent 研发调优（论文第 3 章后半 + 第 4 章主体）
- **当前状态**：`[ ] 待启动`
- **前置条件**：Stage 3 设计书经确认。
- **阶段目标**：在 `research/thesis_agent/` 下实现兼具深层静态程序分析算法厚度与高工程稳定性的科研版 Agent，并在 `Split 1` 完成调优封版。
- **核心算法与工程实现（全部基于纯 Python + 现有验证器 JSON 图）**：
  - [ ] **4.1 逆向语义依赖切片与最小扰动局部修复算法（攻克语法合规与防退化）**：
    - 结合本地 `sysml.library` 符号索引执行确定性标准库导入预修复与 `SysMLValidator` 规范码条款转译；
    - 在 `partial_model` 实体关系图上运行 **$k$-hop 逆向语义依赖切片（Backward Semantic Slicing）**，精确提取“出错块 + 被引用类型定义签名”最小充分上下文，实施基于 AST 偏移量的局部补丁替换，并基于综合缺陷势能函数执行防退化自动回滚。
  - [ ] **4.2 Def-Usage 契约先行合成与二部图/可达性静态审查算法（攻克“高编译合规假象”与低召回率）**：
    - 依据 SysML v2 `Definition-Usage` 二元语法规定实施“全局类型/共轭端口契约锁定 $\rightarrow$ 实例用法组装”两阶段合成，配合 `Pool 0` 语法构型按需检索；
    - 编译通过后，运行 **需求核对单与架构图二部图最大匹配（匈牙利算法）** 计算语义要素覆盖度，并运行 **DFS/Tarjan 静态图分析** 检测状态机不可达/死锁节点、悬挂端口与 `Delete-to-Pass` 节点骤降，触发定向增量补全循环。
- **🛑 停靠验收门禁（Gate 4）**：`ThesisAgent` 在 `Split 1` 上单元测试与端到端对比验证通过，确认无过拟合硬编码后 **冻结全部算法超参与提示词（Code & Prompt Freeze）**。

---

### Stage 5：封存盲测集（Split 2）开盲盒评测、消融实验、显著性检验与论文大表生成
- **当前状态**：`[ ] 待启动`
- **前置条件**：Stage 4 正式封版。
- **阶段目标**：解封 `Split 2A（SysMBench 151条）` 与 `Split 2B（Revise 增量演化集）`，一次性跑出支撑南大盲审优/良评定的完整定量证据链。
- **具体任务**：
  - [ ] **5.1 盲测主对比实验（回答 RQ2 & RQ3）**：在 `Split 2A` 与 `Split 2B` 上对比 `B1~B6` 与 `ThesisAgent` 的编译率（`Pass@1..k`）、收敛开销、跨块零退化率、`DiagramIR` 结构拓扑 F1、画布布局稳定率、`CodeBLEU` 与异源裁判 `SysMEval（P/R/F1）`，全部附带 **Wilcoxon $p$-value / Cliff's $\delta$ / McNemar 检验**。
  - [ ] **5.2 逐模块消融实验（回答 RQ4 前半）**：依次消融“规范码转译与静态导入”、“逆向依赖切片局部修复（退回整文件重写）”、“契约先行合成”、“二部图与可达性静态审查”，验证每一核心算法模块的统计显著贡献。
  - [ ] **5.3 跨基座泛化验证（回答 RQ4 后半）**：在另一异源基座模型上抽样复现核心对比（`Zero-Shot` vs `Vanilla GCR` vs `Chunk-RAG` vs `ThesisAgent`）。
  - [ ] **5.4 论文三线表与可视化脚本生成**：在 `research/reports/` 一键导出全部 LaTeX/CSV 表格与分析图。
- **🛑 停靠验收门禁（Gate 5）**：全套盲测数据、显著性检验指标与消融结论核验无误。

---

### Stage 6：科研引擎回接 `SysML Workbench` 与系统级闭环验证（必选 · 支撑论文第 5 章）
- **当前状态**：`[ ] 待启动`
- **前置条件**：Stage 5 实验收官。
- **阶段目标**：将核心算法无损接入三模态工作台，提供系统级性能实测与可视化交互验证，使论文第 3、4 章算法与第 5 章工具平台浑然一体。
- **具体任务**：
  - [ ] **6.1 双引擎模式切换接入**：在后端任务配置与前端左下角设置菜单中支持一键切换 `Standard Mode` 与 `Thesis Spec-Grounded Mode`。
  - [ ] **6.2 三模态诊断与增量修补可视化**：在左下角 LeetCode 风格控制台展示 **根因分类标签、逆向依赖切片范围与局部补丁 Diff**；在 `DiagramIR` 画布上高亮渲染 **二部图未覆盖需求告警、悬挂端口与不可达状态节点**。
  - [ ] **6.3 系统级效能汇总**：汇总常驻守护编译器 P50/P95 响应延迟对比曲线、交互式修订（`Revise`）画布坐标保持率实测数据及完整端到端建模案例。
- **🛑 终极停靠门禁（Gate 6）**：前后端全量测试通过；是否合并回 `main` 分支完全取决于用户最终明确指令。
