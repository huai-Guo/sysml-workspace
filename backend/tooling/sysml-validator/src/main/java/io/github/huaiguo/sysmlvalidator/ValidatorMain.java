package io.github.huaiguo.sysmlvalidator;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.IdentityHashMap;
import java.util.HashSet;
import java.util.Set;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.xtext.nodemodel.ICompositeNode;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.omg.sysml.lang.sysml.Comment;
import org.omg.sysml.lang.sysml.ConjugatedPortDefinition;
import org.omg.sysml.lang.sysml.Connector;
import org.omg.sysml.lang.sysml.Element;
import org.omg.sysml.lang.sysml.Feature;
import org.omg.sysml.lang.sysml.FeatureTyping;
import org.omg.sysml.lang.sysml.FeatureValue;
import org.omg.sysml.lang.sysml.Flow;
import org.omg.sysml.lang.sysml.Membership;
import org.omg.sysml.lang.sysml.Multiplicity;
import org.omg.sysml.lang.sysml.Relationship;
import org.omg.sysml.lang.sysml.RequirementDefinition;
import org.omg.sysml.lang.sysml.RequirementUsage;
import org.omg.sysml.lang.sysml.SatisfyRequirementUsage;
import org.omg.sysml.lang.sysml.StateUsage;
import org.omg.sysml.lang.sysml.TransitionUsage;
import org.omg.sysml.lang.sysml.Type;
import org.omg.sysml.lang.sysml.VerificationCaseUsage;

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
    private static final Gson COMPACT_GSON = new GsonBuilder()
            .serializeNulls()
            .disableHtmlEscaping()
            .create();

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

        if (parsed.daemon) {
            runDaemon(interactive, protocolOut);
            return 0;
        }

        String source = parsed.filePath == null
                ? new String(System.in.readAllBytes(), StandardCharsets.UTF_8)
                : Files.readString(Path.of(parsed.filePath), StandardCharsets.UTF_8);

        if (source.isBlank()) {
            throw new IOException("SysML source is empty.");
        }

        return evaluateOnce(interactive, source, protocolOut, false);
    }

    private static void runDaemon(SysMLInteractive interactive, java.io.PrintStream protocolOut) throws IOException {
        protocolOut.println("{\"status\":\"ready\"}");
        protocolOut.flush();

        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                JsonObject req = JsonParser.parseString(trimmed).getAsJsonObject();
                if (req.has("shutdown") && req.get("shutdown").getAsBoolean()) {
                    break;
                }
                String source;
                if (req.has("source_base64") && !req.get("source_base64").isJsonNull()) {
                    byte[] decoded = Base64.getDecoder().decode(req.get("source_base64").getAsString());
                    source = new String(decoded, StandardCharsets.UTF_8);
                } else if (req.has("file") && !req.get("file").isJsonNull()) {
                    source = Files.readString(Path.of(req.get("file").getAsString()), StandardCharsets.UTF_8);
                } else {
                    protocolOut.println(compactFailureJson("internal", "Daemon request missing source_base64."));
                    protocolOut.flush();
                    continue;
                }

                if (source.isBlank()) {
                    protocolOut.println(compactFailureJson("syntax", "SysML source is empty."));
                    protocolOut.flush();
                    continue;
                }

                evaluateOnce(interactive, source, protocolOut, true);
                protocolOut.flush();
            } catch (Exception ex) {
                String msg = ex.getMessage();
                if (msg == null || msg.isBlank()) {
                    msg = ex.getClass().getName();
                }
                protocolOut.println(compactFailureJson("internal", msg));
                protocolOut.flush();
            }
        }
    }

    private static int evaluateOnce(
            SysMLInteractive interactive,
            String source,
            java.io.PrintStream protocolOut,
            boolean compactLine
    ) throws IOException {
        try {
            SysMLInteractiveResult result = interactive.process(source, false);

            if (result.getException() != null) {
                String message = result.getException().getMessage();
                if (message == null || message.isBlank()) {
                    message = result.getException().getClass().getName();
                }
                protocolOut.println(compactLine ? compactFailureJson("internal", message) : failureJson("internal", message));
                return 2;
            }

            List<Issue> issues = new ArrayList<>(result.getIssues());
            boolean valid = !result.hasErrors();
            if (compactLine) {
                Map<String, Object> payload = new LinkedHashMap<>();
                Map<String, Object> valMeta = new LinkedHashMap<>();
                valMeta.put("name", VALIDATOR_NAME);
                valMeta.put("version", VALIDATOR_VERSION);
                valMeta.put("tag", VALIDATOR_TAG);
                payload.put("validator", valMeta);
                payload.put("valid", valid);

                List<Map<String, Object>> diagList = new ArrayList<>(issues.size());
                for (Issue issue : issues) {
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("severity", issue.getSeverity().name().toLowerCase(Locale.ROOT));
                    d.put("kind", issue.isSyntaxError() ? "syntax" : "semantic");
                    d.put("message", issue.getMessage() == null ? "" : issue.getMessage());
                    d.put("line", issue.getLineNumber());
                    d.put("column", issue.getColumn());
                    d.put("offset", issue.getOffset());
                    d.put("length", issue.getLength());
                    d.put("code", issue.getCode());
                    d.put("source", "omg-pilot");
                    diagList.add(d);
                }
                payload.put("diagnostics", diagList);
                if (valid) {
                    payload.put("model", exportModel(result.getRootElement()));
                }
                protocolOut.println(COMPACT_GSON.toJson(payload));
            } else {
                String json = resultJson(valid, issues);
                if (valid) {
                    String model = COMPACT_GSON.toJson(exportModel(result.getRootElement()));
                    json = json.substring(0, json.lastIndexOf('}')) + ",\n  \"model\": " + model + "\n}";
                }
                protocolOut.println(json);
            }
            return valid ? 0 : 1;
        } finally {
            interactive.removeResource();
        }
    }

    private static String compactFailureJson(String kind, String message) {
        Map<String, Object> payload = new LinkedHashMap<>();
        Map<String, Object> valMeta = new LinkedHashMap<>();
        valMeta.put("name", VALIDATOR_NAME);
        valMeta.put("version", VALIDATOR_VERSION);
        valMeta.put("tag", VALIDATOR_TAG);
        payload.put("validator", valMeta);
        payload.put("valid", false);
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("severity", "error");
        d.put("kind", kind);
        d.put("message", message == null ? "" : message);
        d.put("line", null);
        d.put("column", null);
        d.put("offset", null);
        d.put("length", null);
        d.put("code", null);
        d.put("source", "sysml-agent-validator");
        payload.put("diagnostics", List.of(d));
        return COMPACT_GSON.toJson(payload);
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
                Set<Element> explicitTypes = new HashSet<>();
                for (FeatureTyping typing : feature.getOwnedTyping()) {
                    if (!typing.isImplied() && typing.getType() != null) {
                        explicitTypes.add(typing.getType());
                    }
                }
                List<Map<String, Object>> typeRefs = new ArrayList<>();
                for (Type type : feature.getType()) {
                    Map<String, Object> ref = reference(type, ids);
                    boolean isConjugated = type instanceof ConjugatedPortDefinition;
                    if (isConjugated) {
                        ConjugatedPortDefinition cpd = (ConjugatedPortDefinition) type;
                        Element orig = cpd.getOriginalPortDefinition();
                        ref.put("conjugated", true);
                        if (orig != null) {
                            ref.put("original_id", ids.get(orig));
                            ref.put("original_name", orig.getQualifiedName());
                            ref.put("original_label", orig.getName());
                        }
                    }
                    ref.put("implied", !explicitTypes.contains(type) && !isConjugated);
                    typeRefs.add(ref);
                }
                entity.put("types", typeRefs);
                entity.put("chaining_features", feature.getChainingFeature().stream().map(part -> reference(part, ids)).toList());
                if (feature.getDirection() != null) entity.put("direction", feature.getDirection().getLiteral());

                for (Membership m : feature.getOwnedMembership()) {
                    if (m instanceof FeatureValue fv && fv.getValue() != null) {
                        String valText = nodeText(fv.getValue());
                        if (valText != null && !valText.isEmpty()) {
                            entity.put("value_text", valText);
                            break;
                        }
                    }
                }
            }
            for (Element owned : element.getOwnedElement()) {
                if (owned instanceof Multiplicity mult) {
                    String multText = nodeText(mult);
                    if (multText != null && !multText.isEmpty()) {
                        entity.put("multiplicity", multText);
                        break;
                    }
                }
            }
            if (element instanceof Comment comment && comment.getBody() != null) {
                entity.put("body", comment.getBody().trim());
            }
            if (element instanceof RequirementDefinition reqDef) {
                if (reqDef.getReqId() != null) entity.put("req_id", reqDef.getReqId());
                if (reqDef.getText() != null && !reqDef.getText().isEmpty()) {
                    entity.put("req_text", String.join(" ", reqDef.getText()).trim());
                }
            } else if (element instanceof RequirementUsage reqUsage) {
                if (reqUsage.getReqId() != null) entity.put("req_id", reqUsage.getReqId());
                if (reqUsage.getText() != null && !reqUsage.getText().isEmpty()) {
                    entity.put("req_text", String.join(" ", reqUsage.getText()).trim());
                }
            }
            if (element instanceof StateUsage stateUsage) {
                if (stateUsage.getEntryAction() != null && ids.containsKey(stateUsage.getEntryAction())) {
                    entity.put("entry_action_id", ids.get(stateUsage.getEntryAction()));
                }
                if (stateUsage.getDoAction() != null && ids.containsKey(stateUsage.getDoAction())) {
                    entity.put("do_action_id", ids.get(stateUsage.getDoAction()));
                }
                if (stateUsage.getExitAction() != null && ids.containsKey(stateUsage.getExitAction())) {
                    entity.put("exit_action_id", ids.get(stateUsage.getExitAction()));
                }
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
                String payloadLabel = null;
                if (element instanceof Flow flow && flow.getPayloadType() != null && !flow.getPayloadType().isEmpty()) {
                    List<String> pNames = flow.getPayloadType().stream()
                            .map(Element::getName)
                            .filter(n -> n != null && !n.isBlank())
                            .toList();
                    if (!pNames.isEmpty()) payloadLabel = String.join(", ", pNames);
                }
                for (Element source : sources) for (Element target : targets) {
                    if (source == null || target == null) continue;
                    Map<String, Object> rel = new LinkedHashMap<>();
                    rel.put("id", "r" + relations.size());
                    rel.put("kind", element.eClass().getName());
                    rel.put("semantic_id", ids.get(element));
                    if (element.getDeclaredName() != null) rel.put("name", element.getDeclaredName());
                    if (payloadLabel != null) rel.put("payload", payloadLabel);
                    rel.put("source", reference(source, ids));
                    rel.put("target", reference(target, ids));
                    relations.add(rel);
                    if (relations.size() > 10000) throw new IOException("Model exceeds 10000 relationships.");
                }
            } else if (element instanceof TransitionUsage trans) {
                Element source = trans.getSource();
                Element target = trans.getTarget();
                if (source != null && target != null) {
                    Map<String, Object> rel = new LinkedHashMap<>();
                    rel.put("id", "r" + relations.size());
                    rel.put("kind", "TransitionUsage");
                    rel.put("semantic_id", ids.get(element));
                    String transLabel = buildTransitionLabel(trans);
                    if (transLabel != null && !transLabel.isBlank()) rel.put("name", transLabel);
                    rel.put("source", reference(source, ids));
                    rel.put("target", reference(target, ids));
                    relations.add(rel);
                }
            } else if (element instanceof SatisfyRequirementUsage sat) {
                Element source = sat.getSatisfyingFeature();
                Element target = sat.getSatisfiedRequirement();
                if (source != null && target != null) {
                    Map<String, Object> rel = new LinkedHashMap<>();
                    rel.put("id", "r" + relations.size());
                    rel.put("kind", "SatisfyRequirementUsage");
                    rel.put("semantic_id", ids.get(element));
                    if (sat.getDeclaredName() != null) rel.put("name", sat.getDeclaredName());
                    rel.put("source", reference(source, ids));
                    rel.put("target", reference(target, ids));
                    relations.add(rel);
                }
            } else if (element instanceof VerificationCaseUsage ver) {
                for (RequirementUsage req : ver.getVerifiedRequirement()) {
                    if (req == null) continue;
                    Map<String, Object> rel = new LinkedHashMap<>();
                    rel.put("id", "r" + relations.size());
                    rel.put("kind", "VerifyRequirement");
                    rel.put("semantic_id", ids.get(element));
                    if (ver.getDeclaredName() != null) rel.put("name", ver.getDeclaredName());
                    rel.put("source", reference(ver, ids));
                    rel.put("target", reference(req, ids));
                    relations.add(rel);
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

    private static String nodeText(Element element) {
        if (element == null) return null;
        ICompositeNode node = NodeModelUtils.getNode(element);
        if (node == null) return null;
        String text = NodeModelUtils.getTokenText(node);
        return text == null ? null : text.trim().replaceAll("\\s+", " ");
    }

    private static String buildTransitionLabel(TransitionUsage trans) {
        List<String> parts = new ArrayList<>();
        if (trans.getTriggerAction() != null && !trans.getTriggerAction().isEmpty()) {
            String trig = nodeText(trans.getTriggerAction().get(0));
            if (trig != null && !trig.isEmpty()) {
                trig = trig.replaceFirst("^accept\\s+", "").trim();
                parts.add(trig);
            }
        }
        if (trans.getGuardExpression() != null && !trans.getGuardExpression().isEmpty()) {
            String guard = nodeText(trans.getGuardExpression().get(0));
            if (guard != null && !guard.isEmpty()) {
                parts.add("[" + guard + "]");
            }
        }
        if (trans.getEffectAction() != null && !trans.getEffectAction().isEmpty()) {
            String eff = nodeText(trans.getEffectAction().get(0));
            if (eff != null && !eff.isEmpty()) {
                eff = eff.replaceFirst("^do\\s+", "").trim();
                parts.add("/ " + eff);
            }
        }
        if (!parts.isEmpty()) return String.join(" ", parts);
        return trans.getDeclaredName();
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
        private final boolean daemon;

        private Arguments(String libraryPath, String filePath, boolean daemon) {
            this.libraryPath = libraryPath;
            this.filePath = filePath;
            this.daemon = daemon;
        }

        static Arguments parse(String[] args) throws IOException {
            String libraryPath = null;
            String filePath = null;
            boolean daemon = false;

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
                    case "--daemon" -> daemon = true;
                    default -> throw new IOException("Unknown argument: " + args[i]);
                }
            }

            return new Arguments(libraryPath, filePath, daemon);
        }
    }
}
