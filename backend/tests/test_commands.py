from __future__ import annotations

import pytest
from sysml_workspace.diagram.commands import (
    SemanticCommandCompiler,
    CreateConnectionCommand,
    CreateOwnedElementCommand,
    SemanticCommandError,
    audit_delete,
)


def test_compile_connection_command():
    compiler = SemanticCommandCompiler()
    cmd = CreateConnectionCommand(
        parent_id="e_system",
        name="powerLink",
        source_path=("battery", "powerOut"),
        target_path=("motor", "powerIn"),
    )
    plan = compiler.compile_connection(cmd)
    assert plan.kind == "create_connection"
    assert plan.textual_content == "connection powerLink connect battery.powerOut to motor.powerIn;"


def test_compile_element_command():
    compiler = SemanticCommandCompiler()
    
    cmd_part = CreateOwnedElementCommand(
        owner_id="e_sys",
        element_type="part",
        name="sensor",
        type_ref="TempSensor",
    )
    plan_part = compiler.compile_element(cmd_part)
    assert plan_part.textual_content == "part sensor : TempSensor;"

    cmd_pkg = CreateOwnedElementCommand(
        owner_id=None,
        element_type="package",
        name="Telemetry",
    )
    plan_pkg = compiler.compile_element(cmd_pkg)
    assert "package Telemetry" in plan_pkg.textual_content


def test_compiler_rejects_invalid_identifiers():
    compiler = SemanticCommandCompiler()
    with pytest.raises(SemanticCommandError):
        compiler.compile_element(CreateOwnedElementCommand(None, "part", "123_invalid"))


def test_audit_delete_safe_and_referenced():
    snapshot = {
        "entities": [
            {"id": "e1", "name": "Engine", "kind": "PartDefinition"},
            {"id": "e2", "name": "motor", "kind": "PartUsage", "types": [{"id": "e1"}]},
            {"id": "e3", "name": "Chassis", "kind": "PartDefinition"},
        ],
        "relations": [],
    }

    # e3 has no dependents -> safe
    audit_safe = audit_delete(snapshot, "e3")
    assert audit_safe.safe is True
    assert len(audit_safe.reasons) == 0

    # e1 is referenced as type of e2 -> unsafe
    audit_unsafe = audit_delete(snapshot, "e1")
    assert audit_unsafe.safe is False
    assert any("references target" in r for r in audit_unsafe.reasons)
