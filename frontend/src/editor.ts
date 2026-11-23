import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "./types";
import { locationOffset } from "./state";

const keywords =
  "package part def port connection connect to attribute item interface allocation requirement satisfy action perform state transition import private public in out inout flow from to ref redefines subsets specializes enum view viewpoint metadata doc accept send if then else return for while".split(
    " ",
  );
const sysml = StreamLanguage.define({
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.comment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.comment = true;
      return "comment";
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return "number";
    const word = stream.match(/[\w\u0080-\uFFFF]+/);
    if (word && typeof word !== "boolean")
      return keywords.includes(word[0]) ? "keyword" : null;
    stream.next();
    return null;
  },
});

export function formatSysML(source: string): string {
  const lines = source.split(/\r?\n/);
  const formatted: string[] = [];
  let indentLevel = 0;
  const indentStr = "    ";
  let lastWasBlank = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (!lastWasBlank && formatted.length > 0) {
        formatted.push("");
        lastWasBlank = true;
      }
      continue;
    }
    lastWasBlank = false;

    // Count closing braces that dedent the current line
    let leadingClose = 0;
    for (const ch of line) {
      if (ch === "}" || ch === ")") leadingClose++;
      else break;
    }
    const currentIndent = Math.max(0, indentLevel - leadingClose);

    // Compute net brace change across this line
    let net = 0;
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "/" && line[i + 1] === "/") break;
      if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) inStr = !inStr;
      if (!inStr) {
        if (ch === "{" || ch === "(") net++;
        else if (ch === "}" || ch === ")") net--;
      }
    }

    formatted.push(indentStr.repeat(currentIndent) + line);
    indentLevel = Math.max(0, indentLevel + net);
  }
  return formatted.join("\n") + "\n";
}

function toggleLineComment(view: EditorView): boolean {
  const { state } = view;
  const changes = [];
  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) lineNumbers.add(l);
  }
  const sortedLines = Array.from(lineNumbers).sort((a, b) => a - b);
  const allCommented = sortedLines.every((n) => {
    const t = state.doc.line(n).text.trim();
    return t.startsWith("//") || t === "";
  });

  for (const n of sortedLines) {
    const line = state.doc.line(n);
    if (allCommented) {
      const idx = line.text.indexOf("//");
      if (idx !== -1) {
        const removeLen = line.text[idx + 2] === " " ? 3 : 2;
        changes.push({ from: line.from + idx, to: line.from + idx + removeLen, insert: "" });
      }
    } else {
      changes.push({ from: line.from, insert: "// " });
    }
  }
  if (changes.length) {
    view.dispatch({ changes });
    return true;
  }
  return false;
}

export class SourceEditor {
  view: EditorView;
  private silent = false;
  private wrapCompartment = new Compartment();
  private extensions: Extension[];
  constructor(
    parent: HTMLElement,
    readonly = false,
    onChange?: (text: string) => void,
    onRun?: () => void,
    onSave?: () => void,
  ) {
    this.extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      this.wrapCompartment.of(EditorView.lineWrapping),
      sysml,
      syntaxHighlighting(defaultHighlightStyle),
      lintGutter(),
      EditorView.cspNonce.of(
        document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')
          ?.content || "",
      ),
      EditorState.readOnly.of(readonly),
      EditorView.editable.of(!readonly),
      EditorView.contentAttributes.of({
        "aria-label": readonly ? "运行结果代码" : "SysML 源代码编辑器",
        spellcheck: "false",
      }),
      autocompletion({
        override: [
          (context) => {
            const word = context.matchBefore(/[\w]+/);
            return word
              ? {
                  from: word.from,
                  options: keywords.map((label) => ({
                    label,
                    type: "keyword",
                  })),
                }
              : null;
          },
        ],
      }),
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRun?.();
            return true;
          },
        },
        {
          key: "Mod-s",
          run: () => {
            onSave?.();
            return true;
          },
        },
        {
          key: "Mod-/",
          run: (view) => toggleLineComment(view),
        },
        {
          key: "Shift-Alt-f",
          run: () => this.format(),
        },
        {
          key: "Mod-Shift-i",
          run: () => this.format(),
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...closeBracketsKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.silent)
          onChange?.(update.state.doc.toString());
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: "var(--editor-font-size, 13px)",
          backgroundColor: "var(--bg-editor, var(--bg-card))",
          color: "var(--text-primary)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: 'var(--editor-font-family, "JetBrains Mono", "Cascadia Code", Consolas, monospace)',
          lineHeight: "1.7",
        },
        ".cm-content": { padding: "12px 0" },
        ".cm-line": { paddingLeft: "14px" },
        ".cm-gutters": {
          backgroundColor: "var(--bg-editor-gutter, var(--bg-card-header))",
          color: "var(--text-muted)",
          borderRight: "1px solid var(--border-subtle)",
        },
        ".cm-activeLine": { backgroundColor: "var(--bg-editor-active-line, var(--bg-card-hover))" },
        ".cm-activeLineGutter": {
          backgroundColor: "var(--bg-editor-active-gutter, var(--bg-card-hover))",
          color: "var(--accent-blue)",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-cursor": {
          borderLeftColor: "var(--accent-emerald, #10a37f)",
          borderLeftWidth: "2px",
        },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: "rgba(16, 163, 127, 0.25) !important",
        },
        ".cm-keyword": { color: "var(--code-keyword, #38bdf8)", fontWeight: "600" },
        ".cm-string": { color: "var(--code-string, #10b981)" },
        ".cm-number": { color: "var(--code-number, #f59e0b)" },
        ".cm-comment": { color: "var(--code-comment, var(--text-muted))", fontStyle: "italic" },
      }),
    ];
    this.view = new EditorView({
      parent,
      state: EditorState.create({ extensions: this.extensions }),
    });
  }
  get value() {
    return this.view.state.doc.toString();
  }
  reset(value: string) {
    this.view.setState(
      EditorState.create({ doc: value, extensions: this.extensions }),
    );
  }
  setLineWrapping(wrap: boolean) {
    try {
      this.view.dispatch({
        effects: this.wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
      });
    } catch {
      // ignore
    }
  }
  set value(value: string) {
    if (this.value === value) return;
    this.silent = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: value },
    });
    this.silent = false;
  }
  diagnostics(values: Diagnostic[]) {
    const source = this.value;
    this.view.dispatch(
      setDiagnostics(
        this.view.state,
        values.map((d) => {
          const from = locationOffset(source, d);
          return {
            from,
            to: Math.min(source.length, from + Math.max(1, d.length || 1)),
            severity: d.severity === "warning" ? "warning" : "error",
            message: d.message,
          };
        }),
      ),
    );
  }
  go(location: { offset?: number; line?: number; column?: number }) {
    const anchor = locationOffset(this.value, location);
    this.view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
    this.view.focus();
  }
  format(): boolean {
    const current = this.value;
    const formatted = formatSysML(current);
    if (formatted !== current) {
      this.reset(formatted);
      return true;
    }
    return false;
  }
}
