package io.github.huaiguo.sysmlvalidator;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.IdentityHashMap;
import com.google.gson.GsonBuilder;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.omg.sysml.lang.sysml.Element;
import org.omg.sysml.lang.sysml.Relationship;
import org.omg.sysml.lang.sysml.Membership;
import org.omg.sysml.lang.sysml.Feature;
import org.omg.sysml.lang.sysml.Connector;

import org.eclipse.xtext.validation.Issue;
import org.omg.sysml.interactive.SysMLInteractive;
import org.omg.sysml.interactive.SysMLInteractiveResult;

/**
 * Headless JSON adapter around the pinned OMG SysML v2 Pilot Implementation.
 *
 * Exit codes:
 *   0 - model is valid (warnings are allowed)
 *   1 - model contains validation errors
 *   2 - adapter/tooling/argument failure
 */
public final class ValidatorMain {

    private static final String VALIDATOR_NAME = "omg-sysml-v2-pilot";
    private static final String VALIDATOR_VERSION = "0.62.0";
    private static final String VALIDATOR_TAG = "2026-08";

    private ValidatorMain() {
    }

    public static void main(String[] args) {
        // Keep the machine-readable protocol isolated from upstream stdout.
        var protocolOut = System.out;
        System.setOut(System.err);
        int exitCode;
        try {
            exitCode = run(args, protocolOut);
        } catch (Exception exception) {
            String message = exception.getMessage();
            if (message == null || message.isBlank()) {
                message = exception.getClass().getName();
            }
            protocolOut.println(failureJson("internal", message));
            exitCode = 2;
        }
        System.exit(exitCode);
    }

    private static int run(String[] args, java.io.PrintStream protocolOut) throws Exception {
        Arguments parsed = Arguments.parse(args);

        SysMLInteractive interactive = SysMLInteractive.getInstance();
        interactive.setVerbose(false);
        if (parsed.libraryPath != null) {
            String libraryPath = Path.of(parsed.libraryPath)
                    .toAbsolutePath()
                    .normalize()
                    .toString()
                    .replace('\\', '/');
            interactive.loadLibrary(libraryPath);
        }

        String source = parsed.filePath == null
                ? new String(System.in.readAllBytes(), StandardCharsets.UTF_8)
                : Files.readString(Path.of(parsed.filePath), StandardCharsets.UTF_8);

        if (source.isBlank()) {
            throw new IOException("SysML source is empty.");
        }

        SysMLInteractiveResult result = interactive.process(source, false);

        if (result.getException() != null) {
            String message = result.getException().getMessage();
            if (message == null || message.isBlank()) {
                message = result.getException().getClass().getName();
            }
            protocolOut.println(failureJson("internal", message));
            return 2;
        }

        List<Issue> issues = new ArrayList<>(result.getIssues());
        boolean valid = !result.hasErrors();
        String json = resultJson(valid, issues);
        if (valid) {
            String model = new GsonBuilder().serializeNulls().create()
                    .toJson(exportModel(result.getRootElement()));
            json = json.substring(0, json.lastIndexOf('}')) + ",\n  \"model\": " + model + "\n}";
        }
        protocolOut.println(json);
        return valid ? 0 : 1;
    }

    /** Export authored syntax-backed elements, never the entire standard library. */
    private static Map<String, Object> exportModel(Element root) throws IOException {
        List<Element> elements = new ArrayList<>();
        if (root != null) {
            addAuthored(root, elements);
            var iterator = root.eAllContents();
            while (iterator.hasNext()) {
                EObject object = iterator.next();
                if (object instanceof Element element) addAuthored(element, elements);
                if (elements.size() > 5000) throw new IOException("Model exceeds 5000 authored elements.");
            }
        }
        Map<Element, String> ids = new IdentityHashMap<>();
        for (int i = 0; i < elements.size(); i++) ids.put(elements.get(i), "e" + i);
        List<Map<String, Object>> entities = new ArrayList<>();
        List<Map<String, Object>> relations = new ArrayList<>();
        for (Element element : elements) {
            var node = NodeModelUtils.getNode(element);
            Map<String, Object> entity = new LinkedHashMap<>();
            entity.put("id", ids.get(element));
            entity.put("kind", element.eClass().getName());
            entity.put("name", element.getDeclaredName());
            entity.put("qualified_name", element.getQualifiedName());
            Element owner = element.getOwner();
            int depth = 0;
            while (owner != null && !ids.containsKey(owner) && depth++ < 1000) owner = owner.getOwner();
            entity.put("owner_id", ids.get(owner));
            entity.put("location", Map.of("line", node.getStartLine(), "offset", node.getOffset(),
                    "length", node.getLength(), "offset_encoding", "utf-16"));
            if (element instanceof Feature feature) {
                entity.put("types", feature.getType().stream().map(type -> reference(type, ids)).toList());
                entity.put("chaining_features", feature.getChainingFeature().stream().map(part -> reference(part, ids)).toList());
                if (feature.getDirection() != null) entity.put("direction", feature.getDirection().getLiteral());
            }
            entities.add(entity);
            if (owner != null && ids.containsKey(owner)) {
                relations.add(Map.of("id", "owns-" + ids.get(element), "kind", "ownership",
                        "source", reference(owner, ids), "target", reference(element, ids)));
            }
            if (element instanceof Relationship relationship && !(element instanceof Membership)) {
                List<? extends Element> sources = relationship.getSource();
                List<? extends Element> targets = relationship.getTarget();
                if (element instanceof Connector connector) {
                    // Connector endpoints are semantic features, not the owning container.
                    sources = connector.getSourceFeature() == null ? List.of() : List.of(connector.getSourceFeature());
                    targets = connector.getTargetFeature();
                }
                for (Element source : sources) for (Element target : targets) {
                    relations.add(Map.of("id", "r" + relations.size(), "kind", element.eClass().getName(),
                            "semantic_id", ids.get(element), "source", reference(source, ids),
                            "target", reference(target, ids)));
                    if (relations.size() > 10000) throw new IOException("Model exceeds 10000 relationships.");
                }
            }
        }
        return Map.of("schema_version", "1", "entities", entities, "relations", relations,
                "coverage", "authored_elements_and_semantic_relationships",
                "offset_encoding", "utf-16");
    }

    private static void addAuthored(Element element, List<Element> elements) {
        if (element instanceof Membership) return;
        if (element instanceof Relationship relationship && relationship.isImplied()) return;
        var node = NodeModelUtils.getNode(element);
        if (node != null && node.getLength() > 0) elements.add(element);
    }

    private static Map<String, Object> reference(Element element, Map<Element, String> ids) {
        Map<String, Object> ref = new LinkedHashMap<>();
        ref.put("id", ids.get(element));
        ref.put("name", element.getQualifiedName());
        ref.put("label", element.getName());
        ref.put("external", !ids.containsKey(element));
        return ref;
    }

    private static String resultJson(boolean valid, List<Issue> issues) {
        StringBuilder out = new StringBuilder();
        out.append("{\n");
        appendValidatorMetadata(out);
        out.append("  \"valid\": ").append(valid).append(",\n");
        out.append("  \"diagnostics\": [");

        if (!issues.isEmpty()) {
            out.append("\n");
        }

        for (int i = 0; i < issues.size(); i++) {
            Issue issue = issues.get(i);
            out.append("    {\n");
            out.append("      \"severity\": \"")
                    .append(escape(issue.getSeverity().name().toLowerCase(Locale.ROOT)))
                    .append("\",\n");
            out.append("      \"kind\": \"")
                    .append(issue.isSyntaxError() ? "syntax" : "semantic")
                    .append("\",\n");
            out.append("      \"message\": \"")
                    .append(escape(issue.getMessage()))
                    .append("\",\n");
            appendNullableNumber(out, "line", issue.getLineNumber());
            appendNullableNumber(out, "column", issue.getColumn());
            appendNullableNumber(out, "offset", issue.getOffset());
            appendNullableNumber(out, "length", issue.getLength());
            out.append("      \"code\": ")
                    .append(issue.getCode() == null ? "null" : "\"" + escape(issue.getCode()) + "\"")
                    .append(",\n");
            out.append("      \"source\": \"omg-pilot\"\n");
            out.append("    }");
            if (i + 1 < issues.size()) {
                out.append(",");
            }
            out.append("\n");
        }

        out.append("  ]\n");
        out.append("}");
        return out.toString();
    }

    private static String failureJson(String kind, String message) {
        StringBuilder out = new StringBuilder();
        out.append("{\n");
        appendValidatorMetadata(out);
        out.append("  \"valid\": false,\n");
        out.append("  \"diagnostics\": [\n");
        out.append("    {\n");
        out.append("      \"severity\": \"error\",\n");
        out.append("      \"kind\": \"").append(escape(kind)).append("\",\n");
        out.append("      \"message\": \"").append(escape(message)).append("\",\n");
        out.append("      \"line\": null,\n");
        out.append("      \"column\": null,\n");
        out.append("      \"offset\": null,\n");
        out.append("      \"length\": null,\n");
        out.append("      \"code\": null,\n");
        out.append("      \"source\": \"sysml-agent-validator\"\n");
        out.append("    }\n");
        out.append("  ]\n");
        out.append("}");
        return out.toString();
    }

    private static void appendValidatorMetadata(StringBuilder out) {
        out.append("  \"validator\": {\n");
        out.append("    \"name\": \"").append(VALIDATOR_NAME).append("\",\n");
        out.append("    \"version\": \"").append(VALIDATOR_VERSION).append("\",\n");
        out.append("    \"tag\": \"").append(VALIDATOR_TAG).append("\"\n");
        out.append("  },\n");
    }

    private static void appendNullableNumber(StringBuilder out, String name, Integer value) {
        out.append("      \"").append(name).append("\": ")
                .append(value == null ? "null" : value)
                .append(",\n");
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }

        StringBuilder out = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> out.append("\\\\");
                case '"' -> out.append("\\\"");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.toString();
    }

    private static final class Arguments {
        private final String libraryPath;
        private final String filePath;

        private Arguments(String libraryPath, String filePath) {
            this.libraryPath = libraryPath;
            this.filePath = filePath;
        }

        static Arguments parse(String[] args) throws IOException {
            String libraryPath = null;
            String filePath = null;

            for (int i = 0; i < args.length; i++) {
                switch (args[i]) {
                    case "--library" -> {
                        if (++i >= args.length) {
                            throw new IOException("Missing value for --library");
                        }
                        libraryPath = args[i];
                    }
                    case "--file" -> {
                        if (++i >= args.length) {
                            throw new IOException("Missing value for --file");
                        }
                        filePath = args[i];
                    }
                    default -> throw new IOException("Unknown argument: " + args[i]);
                }
            }

            return new Arguments(libraryPath, filePath);
        }
    }
}
