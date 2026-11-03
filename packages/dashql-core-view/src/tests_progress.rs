//! Unit tests of the execution state: input events, rollups, output events, snapshots and resets.

use super::{EntityState, PlanInputEvent, PlanUpdate, PlanViewModel, SlotRole, SlotSpec, Stats, Status};
use dashql_buffers::view as fb;

/// A join in two pipelines below an execution target:
/// operators 0 (scan build), 1 (scan probe), 2 (join), 3 (execution target),
/// pipeline 0 = slots 0 (scan build, source), 1 (join, sink),
/// pipeline 1 = slots 2 (scan probe, source), 3 (join, through), 4 (execution target, sink)
const JOIN_PLAN: &str = r#"{
    "operator":"executiontarget","operatorId":1,
    "input":{"operator":"join","operatorId":2,
        "left":{"operator":"tablescan","operatorId":3},
        "right":{"operator":"tablescan","operatorId":4}},
    "pipelines":[{"pipelineId":1,"operators":[3,2]},{"pipelineId":2,"operators":[4,2,1]}]
}"#;

fn load(plan: &str) -> PlanViewModel {
    let mut model = PlanViewModel::new();
    model.parse_hyper_plan(plan.as_bytes()).expect("plan must parse");
    model
}

fn slot(time: u64, slot: u32, status: Status, stats: Stats) -> PlanInputEvent {
    PlanInputEvent::UpdateSlot { time, slot, status: Some(status), stats }
}

fn tuples(tuples_in: u64, tuples_out: u64) -> Stats {
    Stats { tuples_in: Some(tuples_in), tuples_out: Some(tuples_out), ..Default::default() }
}

/// The state of an entity in a list of updates
fn state_of(updates: &[PlanUpdate], entity: fb::PlanEntity, index: u32) -> Option<EntityState> {
    updates.iter().find(|u| u.entity == entity && u.index == index).map(|u| u.state)
}

fn snapshot_state(model: &PlanViewModel, entity: fb::PlanEntity, index: u32) -> EntityState {
    state_of(&model.snapshot_events(), entity, index).unwrap_or_default()
}

#[test]
fn an_operator_in_two_pipelines_rolls_up_its_slots() {
    let mut model = load(JOIN_PLAN);
    let updates = model.apply_events(&[
        slot(10, 1, Status::Succeeded, tuples(100, 0)),
        slot(20, 3, Status::Running, Stats { cpu_time_us: Some(7), ..tuples(40, 30) }),
    ]);
    // The join consumed both inputs and produced the output of its probe side, not of its build side
    let join = state_of(&updates, fb::PlanEntity::OPERATOR, 2).unwrap();
    assert_eq!(join.stats.tuples_in, Some(140));
    assert_eq!(join.stats.tuples_out, Some(30));
    assert_eq!(join.stats.cpu_time_us, Some(7));
    assert_eq!(join.status, Status::Running);
    // Every update of a batch carries the time of the batch
    assert!(updates.iter().all(|u| u.time == 20));
    // The build pipeline ends at the join, its output is what reached the sink
    let build = state_of(&updates, fb::PlanEntity::PIPELINE, 0).unwrap();
    assert_eq!((build.status, build.stats.tuples_out), (Status::Succeeded, Some(0)));
    let probe = state_of(&updates, fb::PlanEntity::PIPELINE, 1).unwrap();
    assert_eq!((probe.status, probe.stats.tuples_in, probe.stats.cpu_time_us), (Status::Running, None, Some(7)));
    // The fragment and the query see both pipelines
    let fragment = state_of(&updates, fb::PlanEntity::FRAGMENT, 0).unwrap();
    assert_eq!((fragment.status, fragment.stats.cpu_time_us), (Status::Running, Some(7)));
    let query = state_of(&updates, fb::PlanEntity::QUERY, 0).unwrap();
    assert_eq!(query.status, Status::Running);
}

#[test]
fn reported_values_win_over_rollups() {
    let mut model = load(JOIN_PLAN);
    model.apply_events(&[
        slot(1, 3, Status::Running, tuples(40, 30)),
        PlanInputEvent::UpdateOperator {
            time: 2,
            operator: 2,
            status: Some(Status::Succeeded),
            stats: Stats { tuples_out: Some(99), ..Default::default() },
        },
    ]);
    let join = snapshot_state(&model, fb::PlanEntity::OPERATOR, 2);
    assert_eq!(join.status, Status::Succeeded);
    assert_eq!(join.stats.tuples_out, Some(99));
    // Fields the operator did not report still come from its slots
    assert_eq!(join.stats.tuples_in, Some(40));
}

#[test]
fn unknown_stays_unknown() {
    let mut model = load(JOIN_PLAN);
    model.apply_events(&[slot(1, 0, Status::Running, Stats { tuples_out: Some(5), ..Default::default() })]);
    let scan = snapshot_state(&model, fb::PlanEntity::OPERATOR, 0);
    assert_eq!(scan.stats.tuples_in, None);
    assert_eq!(scan.stats.reported(), fb::PlanStatsField::TUPLES_OUT.0);
    // Entities without any state have no snapshot event
    assert!(state_of(&model.snapshot_events(), fb::PlanEntity::OPERATOR, 1).is_none());
}

#[test]
fn finished_when_all_children_finished() {
    let mut model = load(JOIN_PLAN);
    let at = |started, finished| Stats { started_at: Some(started), finished_at: finished, ..Default::default() };
    model.apply_events(&[slot(1, 1, Status::Succeeded, at(5, Some(9))), slot(1, 3, Status::Running, at(3, None))]);
    let join = snapshot_state(&model, fb::PlanEntity::OPERATOR, 2);
    assert_eq!((join.stats.started_at, join.stats.finished_at), (Some(3), None));
    model.apply_events(&[slot(2, 3, Status::Succeeded, at(3, Some(12)))]);
    let join = snapshot_state(&model, fb::PlanEntity::OPERATOR, 2);
    assert_eq!((join.status, join.stats.finished_at), (Status::Succeeded, Some(12)));
}

#[test]
fn applying_events_twice_changes_nothing() {
    let mut model = load(JOIN_PLAN);
    let events = [slot(1, 1, Status::Running, tuples(10, 0)), slot(1, 3, Status::Running, tuples(4, 3))];
    assert!(!model.apply_events(&events).is_empty());
    assert!(model.apply_events(&events).is_empty());
}

#[test]
fn a_partial_report_keeps_the_other_fields() {
    let mut model = load(JOIN_PLAN);
    model.apply_events(&[slot(1, 0, Status::Running, tuples(10, 8))]);
    let updates = model.apply_events(&[PlanInputEvent::UpdateSlot {
        time: 2,
        slot: 0,
        status: None,
        stats: Stats { tuples_out: Some(9), ..Default::default() },
    }]);
    let scan = state_of(&updates, fb::PlanEntity::SLOT, 0).unwrap();
    assert_eq!((scan.status, scan.stats.tuples_in, scan.stats.tuples_out), (Status::Running, Some(10), Some(9)));
}

#[test]
fn nested_fragments_count_operators_once() {
    let mut model = load(
        r#"{"operator":"federate","inputs":[{"operator":"map","input":
            {"operator":"federate","inputs":[{"operator":"scan"}]}}]}"#,
    );
    let memory = |operator, bytes| PlanInputEvent::UpdateOperator {
        time: 1,
        operator,
        status: Some(Status::Succeeded),
        stats: Stats { memory_bytes: Some(bytes), ..Default::default() },
    };
    // Operators 0 (scan) and 1 (inner federate) belong to the inner fragment, 2 (map) and 3 to the outer one.
    // A fragment is its own work, the query all of it.
    model.apply_events(&[memory(0, 1), memory(1, 2), memory(2, 4), memory(3, 8)]);
    assert_eq!(snapshot_state(&model, fb::PlanEntity::FRAGMENT, 1).stats.memory_bytes, Some(3));
    assert_eq!(snapshot_state(&model, fb::PlanEntity::FRAGMENT, 0).stats.memory_bytes, Some(12));
    assert_eq!(snapshot_state(&model, fb::PlanEntity::QUERY, 0).stats.memory_bytes, Some(15));
    assert_eq!(snapshot_state(&model, fb::PlanEntity::QUERY, 0).status, Status::Succeeded);
}

#[test]
fn analyzed_plans_are_an_event_batch() {
    let model = load(
        r#"{"operator":"executiontarget","statistics":{"output-rows":3},
            "input":{"operator":"tablescan","statistics":{"processed-rows":10,"output-rows":3}}}"#,
    );
    let scan = snapshot_state(&model, fb::PlanEntity::OPERATOR, 0);
    assert_eq!((scan.stats.tuples_in, scan.stats.tuples_out), (Some(10), Some(3)));
    // The hidden root fragment takes its output from its root operator
    assert_eq!(snapshot_state(&model, fb::PlanEntity::FRAGMENT, 0).stats.tuples_out, Some(3));
}

#[test]
fn pipelines_and_fragments_register_at_runtime() {
    let mut model = load(r#"{"operator":"output","input":{"operator":"filter","input":{"operator":"scan"}}}"#);
    let version = model.structure_version();
    let updates = model.apply_events(&[
        PlanInputEvent::RegisterFragment { time: 1, engine_id: Some("1".into()), parent_fragment: None },
        PlanInputEvent::RegisterPipeline {
            time: 1,
            engine_id: Some("0".into()),
            fragment: Some(0),
            slots: vec![
                SlotSpec { operator: 0, role: SlotRole::Source },
                SlotSpec { operator: 1, role: SlotRole::Through },
                SlotSpec { operator: 2, role: SlotRole::Sink },
            ],
        },
        slot(2, 1, Status::Running, tuples(10, 4)),
    ]);
    assert_eq!(model.structure_version(), version + 2);
    // Registered entities without state are no update, the slot and what rolls up from it are
    assert!(state_of(&updates, fb::PlanEntity::SLOT, 0).is_none());
    assert_eq!(state_of(&updates, fb::PlanEntity::OPERATOR, 1).unwrap().stats.tuples_out, Some(4));
    assert_eq!(state_of(&updates, fb::PlanEntity::PIPELINE, 0).unwrap().status, Status::Running);
    assert_eq!(state_of(&updates, fb::PlanEntity::FRAGMENT, 0).unwrap().status, Status::Running);

    // The edges inside the pipeline are carried by the slots of their children
    let buffer = model.pack_buffer();
    let plan = flatbuffers::root::<fb::PlanViewModel>(&buffer).unwrap();
    assert_eq!(plan.structure_version(), version + 2);
    let edge_slots: Vec<u32> = plan.operator_edges().unwrap().iter().map(|e| e.slot()).collect();
    assert_eq!(edge_slots, vec![0, 1]);

    // Events that reference unknown entities are ignored
    let ignored = model.apply_events(&[
        PlanInputEvent::RegisterFragment { time: 3, engine_id: None, parent_fragment: Some(7) },
        PlanInputEvent::RegisterPipeline {
            time: 3,
            engine_id: None,
            fragment: None,
            slots: vec![SlotSpec { operator: 9, role: SlotRole::Source }],
        },
        slot(3, 42, Status::Failed, Stats::default()),
    ]);
    assert!(ignored.is_empty());
    assert_eq!(model.structure_version(), version + 2);
}

#[test]
fn reset_and_replay_seek_backwards() {
    let mut model = load(JOIN_PLAN);
    let version = model.structure_version();
    let log = vec![
        PlanInputEvent::UpdateQuery { time: 1, status: Some(Status::Running), stats: Stats::default() },
        PlanInputEvent::RegisterPipeline {
            time: 2,
            engine_id: None,
            fragment: Some(0),
            slots: vec![SlotSpec { operator: 0, role: SlotRole::Source }],
        },
        slot(3, 5, Status::Running, tuples(1, 1)),
        slot(4, 1, Status::Succeeded, tuples(100, 0)),
    ];
    // The states, the change times depend on the batches
    let states = |model: &PlanViewModel| -> Vec<_> {
        model.snapshot_events().into_iter().map(|u| (u.entity, u.index, u.state)).collect()
    };
    model.apply_events(&log);
    let at_end = states(&model);

    model.reset_execution();
    assert!(model.snapshot_events().is_empty());
    assert_eq!(model.structure_version(), version + 2);
    assert_eq!(flatbuffers::root::<fb::PlanViewModel>(&model.pack_buffer()).unwrap().slots().unwrap().len(), 5);

    // Replaying the log up to a point shows the state of that point, replaying all of it the end state
    model.apply_events(&log[..1]);
    assert_eq!(snapshot_state(&model, fb::PlanEntity::QUERY, 0).status, Status::Running);
    assert!(state_of(&model.snapshot_events(), fb::PlanEntity::OPERATOR, 2).is_none());
    model.apply_events(&log[1..]);
    assert_eq!(states(&model), at_end);
}

#[test]
fn input_events_have_a_json_form() {
    let json = r#"[
        {"type":"updateQuery","time":1,"status":"running","stats":{"workDone":3,"workTotal":10}},
        {"type":"registerPipeline","time":2,"engineId":"7","fragment":0,
         "slots":[{"operator":0,"role":"source"},{"operator":2,"role":"sink"}]},
        {"type":"updateSlot","time":3,"slot":5,"stats":{"tuplesOut":4,"cpuTimeUs":12}}
    ]"#;
    let events: Vec<PlanInputEvent> = serde_json::from_str(json).unwrap();
    assert_eq!(events.len(), 3);
    let reserialized = serde_json::to_string(&events).unwrap();
    assert_eq!(serde_json::from_str::<Vec<PlanInputEvent>>(&reserialized).unwrap(), events);

    let mut model = load(JOIN_PLAN);
    let updates = model.apply_events_json(json.as_bytes()).unwrap();
    let query = state_of(&updates, fb::PlanEntity::QUERY, 0).unwrap();
    assert_eq!((query.status, query.stats.work_done, query.stats.work_total), (Status::Running, Some(3), Some(10)));
    assert_eq!(state_of(&updates, fb::PlanEntity::SLOT, 5).unwrap().stats.cpu_time_us, Some(12));

    // Unknown fields are rejected, a typo must not silently drop a counter
    let typo = r#"[{"type":"updateSlot","time":1,"slot":0,"stats":{"tuples":1}}]"#;
    assert!(serde_json::from_str::<Vec<PlanInputEvent>>(typo).is_err());
}

#[test]
fn packed_events_carry_the_reported_fields() {
    let mut model = load(JOIN_PLAN);
    let updates = model.apply_events(&[slot(5, 0, Status::Running, tuples(10, 8))]);
    let buffer = model.pack_events(&updates);
    let events = flatbuffers::root::<fb::PlanEvents>(&buffer).unwrap();
    assert_eq!(events.structure_version(), model.structure_version());
    let event = events.events().unwrap().iter().find(|e| e.entity() == fb::PlanEntity::SLOT).unwrap();
    assert_eq!((event.index(), event.event_time(), event.status()), (0, 5, fb::PlanExecutionStatus::RUNNING));
    let stats = event.stats();
    assert_eq!(stats.reported(), fb::PlanStatsField::TUPLES_IN.0 | fb::PlanStatsField::TUPLES_OUT.0);
    assert_eq!((stats.tuples_in(), stats.tuples_out()), (10, 8));
}
