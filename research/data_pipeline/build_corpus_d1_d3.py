"""
Phase 1 (D1-D3): Provenance Freeze, Cross-Corpus Deduplication, Local Dependency Bundling,
and OMG Pilot 0.63.1 Compile Admission + AST Profiling Pipeline.
"""
from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any

from sysml_workspace.parser import PilotSubprocessValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "research" / "data" / "raw"
INTERIM_DIR = REPO_ROOT / "research" / "data" / "interim"
PROCESSED_DIR = REPO_ROOT / "research" / "data" / "processed"
TOOLING_DIR = REPO_ROOT / "backend" / "tooling" / "sysml-validator"

JACCARD_LEAKAGE_THRESHOLD = 0.50
INTERNAL_DUP_THRESHOLD = 0.85
MAX_INLINED_LOC = 350


def strip_comments_and_collapse(text: str) -> str:
    t = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    t = re.sub(r"//[^\n]*", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def code_tokens(text: str) -> set[str]:
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", strip_comments_and_collapse(text)))


def norm_sha256(text: str) -> str:
    return hashlib.sha256(strip_comments_and_collapse(text).encode("utf-8")).hexdigest()


def raw_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


def git_info(repo_dir: Path) -> dict[str, str]:
    def _run(args: list[str]) -> str:
        try:
            out = subprocess.check_output(
                ["git", "-C", str(repo_dir), *args],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            return out.strip()
        except Exception:
            return ""

    return {
        "remote_url": _run(["remote", "get-url", "origin"]),
        "commit_sha": _run(["rev-parse", "HEAD"]),
        "commit_short": _run(["rev-parse", "--short", "HEAD"]),
        "commit_date": _run(["log", "-1", "--format=%ci"]),
    }


def extract_top_level_packages(text: str) -> list[str]:
    cleaned = strip_comments_and_collapse(text)
    found = re.findall(r"\b(?:standard\s+library\s+|library\s+)?package\s+(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))", cleaned)
    return [a or b for a, b in found]


def extract_imported_namespaces(text: str) -> list[str]:
    cleaned = strip_comments_and_collapse(text)
    found = re.findall(r"\bimport\s+(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))", cleaned)
    return [a or b for a, b in found]


def try_bundle_local_dependencies(
    target_file: Path,
    pkg_index: dict[str, Path],
    max_loc: int = MAX_INLINED_LOC,
) -> tuple[str, list[str]]:
    """
    If `target_file` imports sibling packages defined inside the same repository,
    prepend those missing local packages in topological order (staying within `max_loc`).
    """
    visited: set[Path] = set()
    ordered_files: list[Path] = []

    def _dfs(f: Path) -> None:
        if f in visited:
            return
        visited.add(f)
        txt = f.read_text(encoding="utf-8", errors="replace")
        own_pkgs = set(extract_top_level_packages(txt))
        for imp in extract_imported_namespaces(txt):
            if imp in own_pkgs:
                continue
            dep = pkg_index.get(imp)
            if dep is not None and dep != f:
                _dfs(dep)
        ordered_files.append(f)

    _dfs(target_file)
    if len(ordered_files) <= 1:
        return target_file.read_text(encoding="utf-8", errors="replace"), []

    parts: list[str] = []
    dep_names: list[str] = []
    total_loc = 0
    for f in ordered_files:
        txt = f.read_text(encoding="utf-8", errors="replace").strip()
        total_loc += len(txt.splitlines())
        if total_loc > max_loc:
            return target_file.read_text(encoding="utf-8", errors="replace"), []
        parts.append(txt)
        if f != target_file:
            dep_names.append(f.name)

    return "\n\n".join(parts) + "\n", dep_names


def profile_semantic_model(source: str, semantic_model: dict[str, Any]) -> dict[str, Any]:
    entities = semantic_model.get("entities") or []
    relations = semantic_model.get("relations") or []
    kind_counts = Counter(str(e.get("kind") or "") for e in entities)
    rel_counts = Counter(str(r.get("kind") or "") for r in relations)

    conjugated_ports = 0
    for e in entities:
        if e.get("kind") == "PortUsage":
            for t in e.get("types") or []:
                if isinstance(t, dict) and t.get("conjugated"):
                    conjugated_ports += 1
                    break

    definitions = sum(v for k, v in kind_counts.items() if k.endswith("Definition"))
    usages = sum(v for k, v in kind_counts.items() if k.endswith("Usage"))
    ports = kind_counts.get("PortUsage", 0) + kind_counts.get("PortDefinition", 0)
    connections = (
        kind_counts.get("ConnectionUsage", 0)
        + kind_counts.get("InterfaceUsage", 0)
        + kind_counts.get("BindingConnectorAsUsage", 0)
        + rel_counts.get("ConnectionUsage", 0)
    )
    flows = kind_counts.get("FlowUsage", 0) + kind_counts.get("SuccessionFlowUsage", 0)
    states = kind_counts.get("StateUsage", 0) + kind_counts.get("StateDefinition", 0)
    transitions = kind_counts.get("TransitionUsage", 0)
    actions = kind_counts.get("ActionUsage", 0) + kind_counts.get("ActionDefinition", 0)
    requirements = kind_counts.get("RequirementUsage", 0) + kind_counts.get("RequirementDefinition", 0)
    constraints = kind_counts.get("ConstraintUsage", 0) + kind_counts.get("ConstraintDefinition", 0)
    attributes = kind_counts.get("AttributeUsage", 0) + kind_counts.get("AttributeDefinition", 0)

    tags: list[str] = []
    if kind_counts.get("PartDefinition", 0) > 0:
        tags.append("part_def")
    if kind_counts.get("PartUsage", 0) > 0:
        tags.append("part_usage")
    if ports > 0:
        tags.append("port")
    if conjugated_ports > 0:
        tags.append("conjugated_port")
    if connections > 0:
        tags.append("connection")
    if flows > 0:
        tags.append("flow")
    if states > 0 or transitions > 0:
        tags.append("state_machine")
    if actions > 0:
        tags.append("action")
    if requirements > 0:
        tags.append("requirement")
    if constraints > 0:
        tags.append("constraint")
    if attributes > 0:
        tags.append("attribute")
    if not tags:
        tags.append("general_structure")

    loc = len([ln for ln in source.splitlines() if ln.strip()])
    ent_n = len(entities)
    rel_n = len(relations)
    if loc <= 30 and ent_n <= 20:
        difficulty = "simple"
    elif loc <= 85 and ent_n <= 65:
        difficulty = "medium"
    else:
        difficulty = "complex"

    return {
        "loc": loc,
        "entity_count": ent_n,
        "relation_count": rel_n,
        "grammar_tags": tags,
        "difficulty": difficulty,
        "ast_summary": {
            "definitions": definitions,
            "usages": usages,
            "ports": ports,
            "conjugated_ports": conjugated_ports,
            "connections": connections,
            "flows": flows,
            "states": states,
            "transitions": transitions,
            "actions": actions,
            "requirements": requirements,
            "constraints": constraints,
            "attributes": attributes,
        },
    }


async def main() -> None:
    INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    lock = json.loads((TOOLING_DIR / "upstream.lock.json").read_text(encoding="utf-8"))
    validator_meta = {
        "name": "omg-sysml-v2-pilot",
        "version": str(lock["pilotVersion"]),
        "tag": str(lock["tag"]),
        "commit": str(lock["commit"]),
    }

    # --- D1: Freeze Provenance Registry ---
    provenance_registry: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "validator": validator_meta,
        "sources": {
            "SRC-01": {
                "name": "SysMBench (PKU et al., arXiv:2508.03215, 2025)",
                "role": "split2a_blind_external_test",
                "license": "Academic benchmark (upstream mirror in cmuchancel/Generate-Compile-Repair-SysMLv2)",
                "local_dir": "research/data/raw/src01_02_cmu_gcr_sysmbench/sysmbench_original_upstream/dataset/sysml",
                **git_info(RAW_DIR / "src01_02_cmu_gcr_sysmbench"),
            },
            "SRC-04": {
                "name": "OMG SysML-v2-Release Official Corpus",
                "role": "split1_dev_diagnostic_primary (strictly Jaccard < 0.50 disjoint from SRC-01)",
                "license": "EPL-2.0",
                "local_dir": "research/data/raw/src04_omg_sysml_v2_release/sysml/src",
                **git_info(RAW_DIR / "src04_omg_sysml_v2_release"),
            },
            "SRC-05": {
                "name": "GfSE/SysML-v2-Models (INCOSE German Chapter)",
                "role": "split1_dev_diagnostic_engineering",
                "license": "Apache-2.0 / Open-Source (see repo LICENSE)",
                "local_dir": "research/data/raw/src05_gfse_models/models",
                **git_info(RAW_DIR / "src05_gfse_models"),
            },
        },
        "excluded_sources": [
            {
                "id": "SRC-03",
                "repo": "yasminebouamra/SysMLv2-Benchmark",
                "reason": "239/243 (98.4%) .sysml files are near-duplicates of SRC-04 OMG SysML-v2-Release; prompts contain empty files and syntax-leaking code summaries.",
            },
            {
                "id": "SRC-02-ctx",
                "repo": "cmuchancel/Generate-Compile-Repair-SysMLv2 (ai_agent/context_examples & api_loop/nl_prompts)",
                "reason": "100% exact subset of SRC-01 SysMBench.",
            },
            {
                "id": "HF-QA-V1",
                "repos": [
                    "nomograph/sysml-v2-reasoning-benchmark",
                    "Xizhidian/sysmlv2",
                    "ardalon/semaadb-dataset",
                ],
                "reason": "Non-matching tasks (model comprehension QA, Chinese PDF QA, PlantUML/SysML v1).",
            },
        ],
    }
    (PROCESSED_DIR / "PROVENANCE.json").write_text(
        json.dumps(provenance_registry, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    validator = PilotSubprocessValidator(tooling_dir=TOOLING_DIR, use_daemon=True, timeout_seconds=30)
    await validator.warmup()

    try:
        # --- Step A: Audit SRC-01 SysMBench (151 samples) ---
        smb_root = RAW_DIR / "src01_02_cmu_gcr_sysmbench/sysmbench_original_upstream/dataset/sysml"
        smb_meta_list = json.loads((smb_root / "dataset.json").read_text(encoding="utf-8"))
        smb_records: list[dict[str, Any]] = []
        smb_token_bank: list[tuple[str, set[str]]] = []
        smb_valid_count = 0
        smb_fail_reasons: Counter[str] = Counter()

        for idx, item in enumerate(smb_meta_list):
            sample_id = f"sysmbench_{idx:03d}"
            design_src = str(item.get("design", ""))
            nl_prompt = str(item.get("nl", "")).strip()
            toks = code_tokens(design_src)
            smb_token_bank.append((sample_id, toks))

            res = await validator.validate(design_src)
            is_valid = bool(res.valid and res.semantic_model is not None)
            if is_valid:
                smb_valid_count += 1
                prof = profile_semantic_model(design_src, res.semantic_model)
                err_msg = None
            else:
                first_msg = res.diagnostics[0].message if res.diagnostics else "unknown_error"
                smb_fail_reasons[first_msg[:72]] += 1
                prof = None
                err_msg = first_msg

            rec = {
                "sample_id": sample_id,
                "task_type": "generate",
                "split": "split2a_blind_sysmbench" if is_valid else "excluded_pilot_incompatible",
                "provenance": {
                    "source_id": "SRC-01",
                    "repo": "SysMBench (arXiv:2508.03215)",
                    "commit_or_tag": provenance_registry["sources"]["SRC-01"]["commit_short"],
                    "relative_path": f"dataset/sysml/dataset.json[{idx}]",
                    "license": "Academic benchmark",
                    "prompt_origin": "human_original_verbatim",
                    "dependency_inlined": [],
                },
                "metadata": {
                    "domain": str(item.get("domain") or "unknown"),
                    "original_grammar_label": item.get("grammar"),
                    "language": "en",
                    "prompt_words": len(nl_prompt.split()),
                    **(
                        {
                            "grammar_tags": prof["grammar_tags"],
                            "difficulty": prof["difficulty"],
                            "loc": prof["loc"],
                            "entity_count": prof["entity_count"],
                            "relation_count": prof["relation_count"],
                        }
                        if prof
                        else {"loc": len([l for l in design_src.splitlines() if l.strip()])}
                    ),
                },
                "input": {
                    "requirement_prompt": nl_prompt,
                    "base_sysml": None,
                },
                "reference": {
                    "sysml_source": design_src,
                    "source_sha256": raw_sha256(design_src),
                    "norm_sha256": norm_sha256(design_src),
                    "pilot_valid": is_valid,
                    "pilot_error": err_msg,
                    "ast_summary": prof["ast_summary"] if prof else None,
                },
            }
            smb_records.append(rec)

        (INTERIM_DIR / "sysmbench_audit.jsonl").write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in smb_records) + "\n",
            encoding="utf-8",
        )

        # --- Step B: Collect, Disjoint-Filter (Jaccard < 0.50 vs ALL 151 SysMBench), Bundle & Pilot-Admit Split 1 Candidates ---
        candidate_roots = [
            ("SRC-04", "examples", RAW_DIR / "src04_omg_sysml_v2_release/sysml/src/examples", "EPL-2.0"),
            ("SRC-04", "training", RAW_DIR / "src04_omg_sysml_v2_release/sysml/src/training", "EPL-2.0"),
            ("SRC-04", "validation", RAW_DIR / "src04_omg_sysml_v2_release/sysml/src/validation", "EPL-2.0"),
            ("SRC-05", "models", RAW_DIR / "src05_gfse_models/models", "Open-Source"),
        ]

        split1_admitted: list[dict[str, Any]] = []
        admitted_norm_hashes: set[str] = set()
        admitted_token_sets: list[set[str]] = []
        split1_stats: dict[str, dict[str, int]] = {}

        seq_id = 0
        for src_id, subset_name, root_dir, lic in candidate_roots:
            all_files = sorted(root_dir.rglob("*.sysml"))
            # Build local package index for lightweight sibling dependency bundling
            pkg_index: dict[str, Path] = {}
            for f in all_files:
                txt = f.read_text(encoding="utf-8", errors="replace")
                for pkg_name in extract_top_level_packages(txt):
                    pkg_index.setdefault(pkg_name, f)

            st = {
                "raw_files": len(all_files),
                "dropped_overlap_sysmbench": 0,
                "dropped_internal_dup": 0,
                "dropped_too_short_or_long": 0,
                "admitted_standalone": 0,
                "admitted_with_dep_bundle": 0,
                "failed_pilot": 0,
            }
            split1_stats[f"{src_id}_{subset_name}"] = st

            for f in all_files:
                raw_txt = f.read_text(encoding="utf-8", errors="replace")
                toks = code_tokens(raw_txt)
                if len(toks) < 6:
                    st["dropped_too_short_or_long"] += 1
                    continue

                # Strict anti-leakage gate against ALL 151 SysMBench models!
                max_j = max((jaccard(toks, stoks) for _, stoks in smb_token_bank), default=0.0)
                if max_j >= JACCARD_LEAKAGE_THRESHOLD:
                    st["dropped_overlap_sysmbench"] += 1
                    continue

                # Compile standalone first; if unresolved sibling namespace, try bundling local sibling deps
                res = await validator.validate(raw_txt)
                final_src = raw_txt
                bundled_deps: list[str] = []
                if not res.valid:
                    bundled_src, deps = try_bundle_local_dependencies(f, pkg_index)
                    if deps:
                        res2 = await validator.validate(bundled_src)
                        if res2.valid:
                            res = res2
                            final_src = bundled_src
                            bundled_deps = deps

                if not res.valid or res.semantic_model is None:
                    st["failed_pilot"] += 1
                    continue

                # Re-check leakage & internal dedup on final_src (in case bundling brought in something overlapping)
                final_toks = code_tokens(final_src)
                final_max_j = max((jaccard(final_toks, stoks) for _, stoks in smb_token_bank), default=0.0)
                if final_max_j >= JACCARD_LEAKAGE_THRESHOLD:
                    st["dropped_overlap_sysmbench"] += 1
                    continue

                nh = norm_sha256(final_src)
                if nh in admitted_norm_hashes or any(jaccard(final_toks, prev) >= INTERNAL_DUP_THRESHOLD for prev in admitted_token_sets):
                    st["dropped_internal_dup"] += 1
                    continue

                prof = profile_semantic_model(final_src, res.semantic_model)
                if prof["loc"] < 5 or prof["loc"] > MAX_INLINED_LOC:
                    st["dropped_too_short_or_long"] += 1
                    continue

                admitted_norm_hashes.add(nh)
                admitted_token_sets.append(final_toks)
                if bundled_deps:
                    st["admitted_with_dep_bundle"] += 1
                else:
                    st["admitted_standalone"] += 1

                seq_id += 1
                rel_path = str(f.relative_to(root_dir)).replace("\\", "/")
                domain_hint = rel_path.split("/")[0] if "/" in rel_path else subset_name
                split1_admitted.append(
                    {
                        "sample_id": f"dev_{src_id.lower().replace('-', '')}_{seq_id:03d}",
                        "task_type": "generate",
                        "split": "split1_dev_candidate",
                        "provenance": {
                            "source_id": src_id,
                            "subset": subset_name,
                            "repo": provenance_registry["sources"][src_id]["name"],
                            "commit_or_tag": provenance_registry["sources"][src_id]["commit_short"],
                            "relative_path": rel_path,
                            "license": lic,
                            "prompt_origin": "pending_d4_synthesis",
                            "dependency_inlined": bundled_deps,
                            "max_jaccard_vs_sysmbench": round(final_max_j, 4),
                        },
                        "metadata": {
                            "domain": domain_hint,
                            "language": "en",
                            "grammar_tags": prof["grammar_tags"],
                            "difficulty": prof["difficulty"],
                            "loc": prof["loc"],
                            "entity_count": prof["entity_count"],
                            "relation_count": prof["relation_count"],
                        },
                        "input": {
                            "requirement_prompt": "",
                            "base_sysml": None,
                        },
                        "reference": {
                            "sysml_source": final_src,
                            "source_sha256": raw_sha256(final_src),
                            "norm_sha256": nh,
                            "pilot_valid": True,
                            "ast_summary": prof["ast_summary"],
                        },
                    }
                )

        (INTERIM_DIR / "split1_candidates_admitted.jsonl").write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in split1_admitted) + "\n",
            encoding="utf-8",
        )

        # Summary report
        diff_smb = Counter(r["metadata"]["difficulty"] for r in smb_records if r["reference"]["pilot_valid"])
        diff_s1 = Counter(r["metadata"]["difficulty"] for r in split1_admitted)
        tag_smb = Counter(t for r in smb_records if r["reference"]["pilot_valid"] for t in r["metadata"]["grammar_tags"])
        tag_s1 = Counter(t for r in split1_admitted for t in r["metadata"]["grammar_tags"])

        summary = {
            "validator": validator_meta,
            "sysmbench_total": len(smb_records),
            "sysmbench_pilot_valid": smb_valid_count,
            "sysmbench_pilot_invalid": len(smb_records) - smb_valid_count,
            "sysmbench_valid_difficulty": dict(diff_smb),
            "sysmbench_valid_grammar_tags": dict(tag_smb),
            "sysmbench_top_fail_reasons": smb_fail_reasons.most_common(8),
            "split1_candidates_total_admitted": len(split1_admitted),
            "split1_by_source": split1_stats,
            "split1_difficulty": dict(diff_s1),
            "split1_grammar_tags": dict(tag_s1),
        }
        (PROCESSED_DIR / "D1_D3_AUDIT_SUMMARY.json").write_text(
            json.dumps(summary, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    finally:
        await validator.aclose()


if __name__ == "__main__":
    asyncio.run(main())
