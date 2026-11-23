# SysML Workspace: Tri-Modal Architecture & Synchronization Design

## 1. Vision & The Tri-Modal Interaction Model

The goal of `sysml-workspace` is to break the silos of traditional MBSE tools by unifying three interaction modes:

```text
       [1. Code Editor]           [2. Visual Canvas]
     (CodeMirror 6 / Text)       (Graph IR / Interactive)
              \                         /
               \                       /
                v                     v
         +-----------------------------------+
         |      Unified SysML Semantic       |
         |         Model (SSOT)              |
         +-----------------------------------+
                          ^
                          |
                 [3. Agent Co-Pilot]
             (Natural Language / Repair)
```

### Tri-Modal Roles:
1. **Direct Code Authoring**: Engineers who prefer precision can write SysML v2 directly with syntax highlighting, diagnostic linting, and instant compiler feedback.
2. **Direct Visual Modeling**: System architects can manipulate nodes, ports, and connections on an interactive canvas. Canvas edits compile into canonical SysML text via Semantic Commands.
3. **Agent Co-Pilot**: LLMs assist in generating models from requirements, performing targeted revisions (*"Add temperature sensor to the motor"*), and automatically fixing syntax errors detected by the compiler.

---

## 2. Synchronization Engine (Code <-> Diagram <-> Agent)

### A. Code -> Diagram (Projection Pipeline)
```text
SysML v2 Source Code
       |
       v (Pilot JVM Subprocess)
AST & Semantic Model JSON (Entities & Relations)
       |
       v (sysml_workspace.diagram.projection)
Diagram IR (Hierarchical Nodes, Compartments, Ports, Semantic Edges)
       |
       v (sysml_workspace.diagram.layout)
Layout Coordinates (Nested Container Packing)
       |
       v
Frontend Canvas / SVG
```

### B. Diagram -> Code (Reverse Semantic Commands)
When a user draws a connection between `portA` on `partA` and `portB` on `partB`:
1. The canvas captures the interaction: `sourceNode: partA.portA`, `targetNode: partB.portB`.
2. `sysml_workspace.diagram.prototype.connection_editing` resolves the paths against the current semantic scope.
3. It emits a high-level `CreateConnectionCommand`:
   ```sysml
   connection conn1 connect partA.portA to partB.portB;
   ```
4. The command is applied to the active draft and re-validated by the Pilot compiler.

### C. Agent Interaction Loop (Intent -> Model -> Gate)
1. User provides prompt: *"Model a dual-redundant power distribution unit"*.
2. (Optional) Scoped technical evidence is retrieved from `sysml_workspace.knowledge`.
3. LLM synthesizes SysML v2 candidate code.
4. **Deterministic Gate**: Pilot JVM validates the syntax and semantic rules.
   - If errors occur: The diagnostics (file, line, column, error message) are fed back into `sysml_workspace.agent.workflow.repair` in an automated self-healing loop (up to $N$ iterations).
   - If valid: The resulting semantic model and diagram are returned to the user with full traceability.

---

## 3. Consolidation Decisions (From 3 Repos to 1 Unified Workspace)

| Previous Repository | Migrated Components | Pruned / Redesigned Components | Rationale |
| :--- | :--- | :--- | :--- |
| **`sysml-agent`** | Core LangGraph workflows, LLM adapters (OpenAI, Anthropic, Ollama), Pilot JVM integration, FastAPI server, draft management | Multi-service HTTP dependencies for rendering | Native diagram generation eliminates network latency and failure points. |
| **`sysml-render`** | Graph IR, Projection engine, Layout engine, SVG generator, Connection reverse-compiler | External SysON server dependency for basic rendering | In-process AST projection allows instant local preview without heavy Eclipse Sirius Web overhead. |
| **`sysml-rag`** | Lightweight requirements & technical document retrieval (`contracts/`, `service/store.py`, `retrieval.py`) | Heavy offline OCR evaluation benchmarks (`evaluation/`, OmniDocBench, TableBank) | General OCR benchmarking is outside the scope of a SysML modeling tool; scoped evidence retrieval is all MBSE needs. |
