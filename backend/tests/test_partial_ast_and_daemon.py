from __future__ import annotations

import asyncio
from pathlib import Path

from sysml_workspace.parser import PilotSubprocessValidator
from sysml_workspace.parser.ast_blocks import locate_diagnostic_scopes, scan_sysml_blocks

TOOLING_DIR = Path(__file__).resolve().parent.parent / "tooling" / "sysml-validator"


def test_lexical_block_scanner_handles_nested_and_broken_syntax() -> None:
    broken_source = """package DemoSystem {
    part def Battery {
        /* comment with fake brace { part ignored; } */
        port powerOut;
    }
    part vehicle {
        part b : Battery;
        part brokenPart : ??? ;
    }
}
"""
    blocks = scan_sysml_blocks(broken_source)
    qnames = [b.qualified_name for b in blocks]
    assert "DemoSystem" in qnames
    assert "DemoSystem::Battery" in qnames
    assert "DemoSystem::vehicle" in qnames
    assert "DemoSystem::vehicle::b" in qnames
    assert all("ignored" not in q for q in qnames)

    # Locate enclosing block on the broken line (line 8)
    from sysml_workspace.parser.contracts import SysMLDiagnostic

    diag = SysMLDiagnostic(severity="error", kind="syntax", message="mismatched input", line=8)
    scoped = locate_diagnostic_scopes(broken_source, [diag])
    assert scoped[0][1] is not None
    assert scoped[0][1].qualified_name == "DemoSystem::vehicle"
    assert scoped[0][1].source_origin == "lexical_fallback"


def test_pilot_daemon_valid_and_partial_ast_on_semantic_error() -> None:
    async def _run() -> None:
        validator = PilotSubprocessValidator(tooling_dir=TOOLING_DIR, use_daemon=True)
        try:
            # 1. Valid model
            valid_src = """package WarmCheck {
    part def Engine;
    part car {
        part eng : Engine;
    }
}
"""
            res_ok = await validator.validate(valid_src)
            assert res_ok.valid is True
            assert res_ok.semantic_model is not None
            assert res_ok.partial_model is None

            # 2. Semantic error (unresolved type) -> valid=False, semantic_model=None, partial_model populated!
            semantic_err_src = """package WarmCheck {
    part def Engine;
    part car {
        part eng : UnknownEngineType;
    }
}
"""
            res_err = await validator.validate(semantic_err_src)
            assert res_err.valid is False
            assert res_err.semantic_model is None
            assert len(res_err.diagnostics) > 0
            assert res_err.partial_model is not None
            partial_names = [e.get("name") for e in res_err.partial_model["entities"]]
            assert "WarmCheck" in partial_names
            assert "car" in partial_names
            assert "eng" in partial_names

            # Locate error diagnostic scope using real partial_model AST offsets
            scopes = locate_diagnostic_scopes(
                semantic_err_src,
                res_err.diagnostics,
                partial_model=res_err.partial_model,
            )
            assert any(
                span is not None and span.qualified_name == "WarmCheck::car" and span.source_origin == "partial_ast"
                for _, span in scopes
            )
        finally:
            await validator.aclose()

    asyncio.run(_run())
