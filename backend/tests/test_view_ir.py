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


def test_syson_semantic_recognition_and_view_separation():
    """Verifies Eclipse SysON conventions:
    1. Implicit stdlib base types (`Parts::Part`) are suppressed on untyped parts (`vehicle`).
    2. Conjugated ports (`~PowerPort`) invert direction (`out` -> `in`) and strip duplicate `~`.
    3. General View keeps `Definition` nodes pin-free (ports inside compartments), while Interconnection
       View excludes uninstantiated blueprint definitions and aligns port sides by connection topology.
    4. State internal `entry`/`do` actions render inside `behaviors` compartment, and `TransitionUsage`
       plus feature-chained `SatisfyRequirementUsage` project as clean edges without duplicate boxes.
    """
    rich_model = {
        "schema_version": "1",
        "entities": [
            {"id": "e0", "kind": "Package", "name": "EV", "qualified_name": "EV", "owner_id": None},
            {"id": "e1", "kind": "PortDefinition", "name": "PowerPort", "qualified_name": "EV::PowerPort", "owner_id": "e0"},
            {
                "id": "e2",
                "kind": "ItemUsage",
                "name": "dc",
                "qualified_name": "EV::PowerPort::dc",
                "owner_id": "e1",
                "direction": "out",
                "types": [{"id": None, "name": "Items::Item", "label": "Item", "external": True, "implied": True}],
            },
            {"id": "e3", "kind": "PartDefinition", "name": "Battery", "qualified_name": "EV::Battery", "owner_id": "e0"},
            {
                "id": "e4",
                "kind": "AttributeUsage",
                "name": "capacity",
                "qualified_name": "EV::Battery::capacity",
                "owner_id": "e3",
                "types": [{"id": None, "name": "ScalarValues::Real", "label": "Real", "external": True, "implied": False}],
                "value_text": "75.0",
            },
            {
                "id": "e5",
                "kind": "PortUsage",
                "name": "powerOut",
                "qualified_name": "EV::Battery::powerOut",
                "owner_id": "e3",
                "types": [{"id": "e1", "name": "EV::PowerPort", "label": "PowerPort", "external": False}],
            },
            {"id": "e6", "kind": "PartDefinition", "name": "Inverter", "qualified_name": "EV::Inverter", "owner_id": "e0"},
            {
                "id": "e7",
                "kind": "PortUsage",
                "name": "powerIn",
                "qualified_name": "EV::Inverter::powerIn",
                "owner_id": "e6",
                "types": [
                    {
                        "id": None,
                        "name": "EV::PowerPort::'~PowerPort'",
                        "label": "~PowerPort",
                        "external": True,
                        "conjugated": True,
                        "original_id": "e1",
                        "original_label": "PowerPort",
                    }
                ],
            },
            {
                "id": "e8",
                "kind": "PartUsage",
                "name": "vehicle",
                "qualified_name": "EV::vehicle",
                "owner_id": "e0",
                "types": [{"id": None, "name": "Parts::Part", "label": "Part", "external": True}],
            },
            {
                "id": "e9",
                "kind": "PartUsage",
                "name": "b",
                "qualified_name": "EV::vehicle::b",
                "owner_id": "e8",
                "types": [{"id": "e3", "name": "EV::Battery", "label": "Battery", "external": False}],
            },
            {
                "id": "e10",
                "kind": "PartUsage",
                "name": "inv",
                "qualified_name": "EV::vehicle::inv",
                "owner_id": "e8",
                "multiplicity": "[2]",
                "types": [{"id": "e6", "name": "EV::Inverter", "label": "Inverter", "external": False}],
            },
            {"id": "e_ep_src", "kind": "Feature", "name": None, "owner_id": "e8"},
            {"id": "e_ep_tgt", "kind": "Feature", "name": None, "owner_id": "e8"},
            {
                "id": "e_st_root",
                "kind": "StateUsage",
                "name": "driveSM",
                "qualified_name": "EV::vehicle::driveSM",
                "owner_id": "e8",
            },
            {"id": "e_st_off", "kind": "StateUsage", "name": "off", "qualified_name": "EV::vehicle::driveSM::off", "owner_id": "e_st_root"},
            {
                "id": "e_st_on",
                "kind": "StateUsage",
                "name": "active",
                "qualified_name": "EV::vehicle::driveSM::active",
                "owner_id": "e_st_root",
                "entry_action_id": "e_act_init",
            },
            {
                "id": "e_act_init",
                "kind": "PerformActionUsage",
                "name": "initBus",
                "qualified_name": "EV::vehicle::driveSM::active::initBus",
                "owner_id": "e_st_on",
            },
            {
                "id": "e_trans",
                "kind": "TransitionUsage",
                "name": "boot",
                "qualified_name": "EV::vehicle::driveSM::boot",
                "owner_id": "e_st_root",
            },
            {
                "id": "e_req",
                "kind": "RequirementUsage",
                "name": "capReq",
                "qualified_name": "EV::capReq",
                "owner_id": "e0",
                "req_id": "REQ-01",
            },
            {
                "id": "e_doc",
                "kind": "Documentation",
                "name": None,
                "owner_id": "e_req",
                "body": "/* Capacity >= 60 kWh */",
            },
            {"id": "e_sat_chain", "kind": "Feature", "name": None, "owner_id": "e0"},
        ],
        "relations": [
            {"id": "rc1", "kind": "FeatureChaining", "source": {"id": "e_ep_src"}, "target": {"id": "e9"}},
            {"id": "rc2", "kind": "FeatureChaining", "source": {"id": "e_ep_src"}, "target": {"id": "e5"}},
            {"id": "rc3", "kind": "FeatureChaining", "source": {"id": "e_ep_tgt"}, "target": {"id": "e10"}},
            {"id": "rc4", "kind": "FeatureChaining", "source": {"id": "e_ep_tgt"}, "target": {"id": "e7"}},
            {
                "id": "r_conn",
                "kind": "ConnectionUsage",
                "name": "c1",
                "source": {"id": "e_ep_src"},
                "target": {"id": "e_ep_tgt"},
            },
            {
                "id": "r_trans",
                "kind": "TransitionUsage",
                "name": "cmd [ready]",
                "source": {"id": "e_st_off"},
                "target": {"id": "e_st_on"},
            },
            {"id": "rc_sat1", "kind": "FeatureChaining", "source": {"id": "e_sat_chain"}, "target": {"id": "e8"}},
            {"id": "rc_sat2", "kind": "FeatureChaining", "source": {"id": "e_sat_chain"}, "target": {"id": "e9"}},
            {
                "id": "r_sat",
                "kind": "SatisfyRequirementUsage",
                "source": {"id": "e_sat_chain"},
                "target": {"id": "e_req"},
            },
        ],
    }

    views = ViewProjectionEngine(rich_model, "f" * 64).project_all()

    # 1. General view checks
    gv = views["general"]
    gv_by_name = {n.name: n for n in gv.nodes}
    assert "dc" not in gv_by_name, "Directed items inside PortDefinition belong in compartment, not child boxes"
    pp_items = next(c for c in gv_by_name["PowerPort"].compartments if c.id == "attributes")
    assert "out dc" in pp_items.items[0].text
    assert gv_by_name["vehicle"].typeLabel is None, "Untyped `part vehicle` must not display `: Part`"
    assert gv_by_name["inv"].typeLabel == ": Inverter [2]"
    assert gv_by_name["Battery"].ports == [], "Definition nodes in General View must not mount dangling pins"
    bat_attrs = next(c for c in gv_by_name["Battery"].compartments if c.id == "attributes")
    assert "capacity: Real = 75.0" in bat_attrs.items[0].text
    inv_def_ports = next(c for c in gv_by_name["Inverter"].compartments if c.id == "ports")
    assert "in powerIn : ~PowerPort" in inv_def_ports.items[0].text
    assert "boot" not in gv_by_name, "TransitionUsage must not render as a box node"
    assert "initBus" not in gv_by_name, "State entry subaction must stay inside state compartment"

    # 2. Interconnection view checks
    iv = views["interconnection"]
    iv_names = {n.name for n in iv.nodes}
    assert iv_names == {"vehicle", "b", "inv"}, "Interconnection View must exclude standalone blueprint defs"
    iv_b = next(n for n in iv.nodes if n.name == "b")
    iv_inv = next(n for n in iv.nodes if n.name == "inv")
    assert iv_b.ports[0].direction == "out" and iv_b.ports[0].sideHint == "E"
    assert iv_inv.ports[0].direction == "in" and iv_inv.ports[0].conjugated is True and iv_inv.ports[0].sideHint == "W"
    assert len(iv.edges) == 1 and iv.edges[0].label == "c1"

    # 3. State & Requirements view checks
    sv = views["state"]
    active_st = next(n for n in sv.nodes if n.name == "active")
    assert any("entry / initBus" in it.text for c in active_st.compartments for it in c.items)
    assert len(sv.edges) == 1 and sv.edges[0].label == "cmd [ready]"

    rv = views["requirements"]
    req_node = next(n for n in rv.nodes if n.name == "capReq")
    doc_texts = [it.text for c in req_node.compartments for it in c.items]
    assert 'id = "REQ-01"' in doc_texts
    assert "Capacity >= 60 kWh" in doc_texts
    assert len(rv.edges) == 1 and rv.edges[0].sourceId == "EV::vehicle::b"


