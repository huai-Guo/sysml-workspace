import { EditorState } from "@codemirror/state";
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

export class SourceEditor {
  view: EditorView;
  private silent = false;
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
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: '"Cascadia Code",Consolas,monospace',
          lineHeight: "1.75",
        },
        ".cm-content": { padding: "18px 0" },
        ".cm-line": { paddingLeft: "14px" },
        ".cm-gutters": {
          backgroundColor: "#f8fafc",
          color: "#8b96a8",
          borderRight: "1px solid #edf0f4",
        },
        ".cm-activeLine": { backgroundColor: "#eef7f5" },
        ".cm-activeLineGutter": { backgroundColor: "#e5f0ed" },
        "&.cm-focused": { outline: "none" },
        ".cm-cursor": { borderLeftColor: "#167c68" },
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
}
