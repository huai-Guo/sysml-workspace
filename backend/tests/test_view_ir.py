from __future__ import annotations

import pytest
from sysml_workspace.diagram.view_ir import (
    ViewProjectionEngine,
    SysMLViewIR,
    SysMLViewNode,
    SysMLViewEdge,
)


@pytest.fixture
def sample_semantic_model():
    return {
        "schema_version": "1",
        "entities": [
            {
                "id": "e0",
                "kind": "Package",
                "name": "VehicleModel",
                "qualified_name": "VehicleModel",
                "owner_id": None,
                "location": {"line": 1, "offset": 0, "length": 120},
            },
            {
                "id": "e1",
                "kind": "PartDefinition",
                "name": "Vehicle",
                "qualified_name": "VehicleModel::Vehicle",
                "owner_id": "e0",
                "location": {"line": 2, "offset": 25, "length": 90},
            },
            {
                "id": "e2",
                "kind": "PartUsage",
                "name": "engine",
                "qualified_name": "VehicleModel::Vehicle::engine",
                "owner_id": "e1",
                "types": [{"id": "e_eng_def", "name": "EngineDef", "label": "EngineDef"}],
                "location": {"line": 3, "offset": 45, "length": 30},
            },
            {
                "id": "e3",
                "kind": "PortUsage",
                "name": "fuelIn",
                "qualified_name": "VehicleModel::Vehicle::engine::fuelIn",
                "owner_id": "e2",
                "direction": "in",
                "location": {"line": 4, "offset": 60, "length": 15},
            },
            {
                "id": "e4",
                "kind": "PartUsage",
                "name": "fuelTank",
                "qualified_name": "VehicleModel::Vehicle::fuelTank",
                "owner_id": "e1",
                "types": [{"id": "e_tank_def", "name": "FuelTankDef", "label": "FuelTankDef"}],
                "location": {"line": 5, "offset": 80, "length": 25},
            },
            {
                "id": "e5",
                "kind": "PortUsage",
                "name": "fuelOut",
                "qualified_name": "VehicleModel::Vehicle::fuelTank::fuelOut",
                "owner_id": "e4",
                "direction": "out",
                "location": {"line": 6, "offset": 90, "length": 15},
            },
            {
                "id": "e6",
                "kind": "AttributeUsage",
                "name": "mass",
                "qualified_name": "VehicleModel::Vehicle::mass",
                "owner_id": "e1",
                "types": [{"id": "e_real", "name": "Real", "label": "Real"}],
                "location": {"line": 7, "offset": 105, "length": 10},
            },
        ],
        "relations": [
            {
                "id": "r0",
                "kind": "ConnectionUsage",
                "source": {"id": "e5", "name": "fuelOut"},
                "target": {"id": "e3", "name": "fuelIn"},
            }
        ],
    }


def test_projection_all_views(sample_semantic_model):
    engine = ViewProjectionEngine(
        semantic_model=sample_semantic_model,
        source_sha256="a" * 64,
    )
    views = engine.project_all()

    assert set(views.keys()) == {"general", "interconnection", "state", "requirements"}

    # General View checks
    general_view = views["general"]
    assert general_view.schemaVersion == "2.0"
    assert general_view.rootPackageName == "VehicleModel"
    assert len(general_view.nodes) >= 3
    # Attribute mass should be inside Vehicle's compartments
    vehicle_node = next(n for n in general_view.nodes if n.name == "Vehicle")
    attr_compartment = next(
        (c for c in vehicle_node.compartments if c.id == "attributes"), None
    )
    assert attr_compartment is not None
    assert any("mass" in item.text for item in attr_compartment.items)

    # Interconnection View checks
    intercon_view = views["interconnection"]
    assert intercon_view.viewType == "interconnection"
    engine_node = next(n for n in intercon_view.nodes if n.name == "engine")
    assert len(engine_node.ports) == 1
    assert engine_node.ports[0].direction == "in"
    assert engine_node.ports[0].sideHint == "W"

    tank_node = next(n for n in intercon_view.nodes if n.name == "fuelTank")
    assert len(tank_node.ports) == 1
    assert tank_node.ports[0].direction == "out"
    assert tank_node.ports[0].sideHint == "E"

    # Connection edge should connect engine to fuelTank via ports
    assert len(intercon_view.edges) == 1
    edge = intercon_view.edges[0]
    assert edge.kind == "connection"
    assert edge.sourceId == tank_node.id
    assert edge.targetId == engine_node.id
    assert edge.sourcePortId == tank_node.ports[0].id
    assert edge.targetPortId == engine_node.ports[0].id


def test_serialization_and_empty_models():
    engine = ViewProjectionEngine(
        semantic_model={"schema_version": "1", "entities": [], "relations": []},
        source_sha256="0" * 64,
    )
    views = engine.project_all()
    for view in views.values():
        data = view.model_dump()
        assert data["schemaVersion"] == "2.0"
        assert data["nodes"] == []
        assert data["edges"] == []
        assert data["summary"]["displayedNodes"] == 0


def test_render_svg_includes_view_ir(sample_semantic_model):
    from sysml_workspace.diagram.svg import RenderRequest, SemanticModel, render_svg

    sem_model = SemanticModel.model_validate(sample_semantic_model)
    req = RenderRequest(
        source_sha256="b" * 64,
        semantic_model=sem_model,
    )
    res = render_svg(req)
    assert "svg" in res
    assert "view_ir" in res and res["view_ir"] is not None
    assert res["view_ir"]["schemaVersion"] == "2.0"
    assert "views" in res and len(res["views"]) == 4
    assert "interconnection" in res["views"]

