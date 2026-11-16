//! The state of a connection, ported from `connection_state.test.ts`, `catalog/catalog_update_state.test.ts`,
//! `trino/trino_connection_state.test.ts` and `salesforce/salesforce_connection_state.test.ts` of
//! `packages/dashql/src/runtime/connections/`.

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core::catalog::{CatalogEntryId, CatalogLayer};
use dashql_core::pack::pack_catalog_descriptor;
use dashql_core::script::Script;
use dashql_core_runtime::connections::*;
use serde_json::json;

/// 2026-01-01T00:00:00.000Z
const NOW: Timestamp = 1_767_225_600_000.0;

fn object(value: serde_json::Value) -> JsonObject {
    value.as_object().cloned().unwrap()
}

fn connection(params: ConnectionParams) -> ConnectionState {
    ConnectionState::new("test", ConnectionDetails::new(&params), ConnectionStateOptions::default(), NOW)
}

fn hyper() -> ConnectionState {
    connection(ConnectionParams::default_for(ConnectorType::Hyper))
}

fn apply(connection: &mut ConnectionState, action: ConnectionAction) -> Vec<ConnectionEffect> {
    connection.apply(action, NOW).unwrap().effects
}

fn error(message: &str) -> DetailedError {
    DetailedError::new(message)
}

/// A catalog update, the host keeps its record under the handle `100 + task_id`
fn task(task_id: u32, variant: CatalogUpdateVariant, touched: &[RelationName]) -> CatalogUpdateTask {
    CatalogUpdateTask {
        touched_relations: touched.to_vec(),
        handle: Some(100 + task_id),
        ..CatalogUpdateTask::new(task_id, variant, NOW)
    }
}

/// Publish a descriptor with the declarations of a script into the catalog of a connection
fn publish_descriptor(connection: &ConnectionState, id: CatalogEntryId, text: &str) {
    let mut catalog = connection.catalog().borrow_mut();
    let mut script = Script::with_entry_id(id);
    script.replace_text(text);
    script.analyze(&catalog, true).unwrap();
    let bytes = pack_catalog_descriptor(&script.analyzed.as_ref().unwrap().entry).unwrap();
    catalog.replace_descriptor(id, CatalogLayer::CONNECTION, &bytes).unwrap();
}

fn function_entry_id(connection: &ConnectionState) -> CatalogEntryId {
    connection.function_script().unwrap().catalog_entry_id()
}

// The descriptors of the catalog of a connection

#[test]
fn stopping_aborts_the_pending_publishers_and_clears_the_running_tasks() {
    for (stop, reason) in [(ConnectionAction::Reset, "Connection was reset"), (ConnectionAction::Delete, "Connection was deleted")] {
        let mut database = hyper();
        publish_descriptor(&database, database.relation_entry_id(), "CREATE TABLE stored(id int);");
        for task_id in [0, 1, 2] {
            apply(&mut database, ConnectionAction::UpdateCatalog(task(task_id, CatalogUpdateVariant::FullCatalogRefresh, &[])));
        }
        apply(&mut database, ConnectionAction::CatalogUpdateSucceeded { task_id: 2 });
        let revision = database.revision();
        let effects = apply(&mut database, stop.clone());
        // The host stops the setup, the publishers and the tasks right after the action, before anything else runs,
        // and releases the records of the running and the finished updates
        assert_eq!(
            effects,
            vec![
                ConnectionEffect::CancelSetup,
                ConnectionEffect::InvalidateCatalogBatch,
                ConnectionEffect::CancelCatalogUpdate { task_id: 0, reason },
                ConnectionEffect::CancelCatalogUpdate { task_id: 1, reason },
                ConnectionEffect::Abort { handle: 100, reason },
                ConnectionEffect::Abort { handle: 101, reason },
                ConnectionEffect::Release { handle: 100 },
                ConnectionEffect::Release { handle: 101 },
                ConnectionEffect::Release { handle: 102 },
                ConnectionEffect::StopQueries { reason },
            ],
            "{stop:?}"
        );
        assert!(database.catalog_updates().tasks_running.is_empty());
        assert_eq!(database.catalog_updates().current_full_refresh, None);
        assert!(database.catalog().borrow().descriptor_bytes(database.relation_entry_id()).is_none());
        assert_eq!(database.status(), ConnectionStatus::NotStarted);
        assert_eq!(database.health(), ConnectionHealth::NotStarted);
        assert!(database.revision() > revision);
    }
}

#[test]
fn stopping_stops_the_running_queries() {
    // The queries of a connection are kept by the query executions, the host stops them
    for stop in [ConnectionAction::Reset, ConnectionAction::Delete] {
        let mut database = hyper();
        assert!(apply(&mut database, stop).iter().any(|effect| matches!(effect, ConnectionEffect::StopQueries { .. })));
    }
}

#[test]
fn delete_drops_both_descriptors_and_the_function_script() {
    let mut database = hyper();
    let function_entry = function_entry_id(&database);
    publish_descriptor(&database, database.relation_entry_id(), "CREATE TABLE stored(id int);");
    publish_descriptor(&database, function_entry, "CREATE FUNCTION stored_fn() RETURNS bigint;");
    apply(&mut database, ConnectionAction::Delete);
    let catalog = database.catalog().borrow();
    assert!(catalog.descriptor_bytes(database.relation_entry_id()).is_none());
    assert!(catalog.descriptor_bytes(function_entry).is_none());
    assert!(database.function_script().is_none());
}

#[test]
fn reset_clears_the_catalog_and_keeps_the_function_script() {
    let mut database = hyper();
    publish_descriptor(&database, database.relation_entry_id(), "CREATE TABLE stored(id int);");
    apply(&mut database, ConnectionAction::Reset);
    assert!(database.catalog().borrow().descriptor_bytes(database.relation_entry_id()).is_none());
    assert!(database.function_script().is_some());
}

#[test]
fn a_new_connection_has_a_function_script_with_a_header() {
    let database = hyper();
    let text = database.function_script().unwrap().text().to_string();
    assert!(text.starts_with("-- DashQL Connection Functions.\n"), "{text}");
    assert!(text.contains("-- Catalog Source: -\n-- Last Refresh: 2026-01-01T00:00:00.000Z\n\n"), "{text}");
    let leap = ConnectionState::new(
        "leap",
        ConnectionDetails::default_for(ConnectorType::Hyper),
        ConnectionStateOptions::default(),
        1_709_214_330_123.0,
    );
    let text = leap.function_script().unwrap().text().to_string();
    assert!(text.contains("-- Last Refresh: 2024-02-29T13:45:30.123Z\n"), "{text}");
}

// What executed statements touched

fn name(schema_name: Option<&str>, table_name: &str) -> QualifiedTableNameT {
    let mut name = QualifiedTableNameT::default();
    name.schema_name = schema_name.map(str::to_string);
    name.table_name = Some(table_name.to_string());
    name
}

fn touch(database: &mut ConnectionState, names: Vec<QualifiedTableNameT>) {
    apply(database, ConnectionAction::RelationsTouched(names));
}

/// Start an update of the relations that the connection holds as touched
fn start(database: &mut ConnectionState, task_id: u32, variant: CatalogUpdateVariant) {
    let touched = database.catalog_updates().touched_relations.clone();
    apply(database, ConnectionAction::UpdateCatalog(task(task_id, variant, &touched)));
}

fn a() -> RelationName {
    RelationName::new("hyper", "", "a")
}

#[test]
fn touched_relations_leave_the_schema_to_the_connection_and_name_every_relation_once() {
    let mut database = hyper();
    touch(&mut database, vec![name(None, "a"), name(Some("other"), "b")]);
    touch(&mut database, vec![name(None, "a")]);
    assert_eq!(database.catalog_updates().touched_relations, vec![a(), RelationName::new("hyper", "other", "b")]);
}

#[test]
fn touched_relations_are_taken_by_a_catalog_update_that_succeeds() {
    let mut database = hyper();
    touch(&mut database, vec![name(None, "a")]);
    start(&mut database, 1, CatalogUpdateVariant::RelationRefresh);
    assert!(database.catalog_updates().touched_relations.is_empty());
    assert_eq!(database.catalog_updates().pending_relations(), vec![a()]);
    // An update of relations is no full refresh
    assert_eq!(database.catalog_updates().current_full_refresh, None);
    apply(&mut database, ConnectionAction::CatalogUpdateSucceeded { task_id: 1 });
    assert!(database.catalog_updates().touched_relations.is_empty());
    assert!(!database.catalog_updates().described);
}

#[test]
fn touched_relations_have_no_database_without_a_default() {
    // Trino details without setup params have no default catalog, the statement can't have touched anything
    let mut details = ConnectionDetails::default_for(ConnectorType::Trino);
    details.setup_params = None;
    let mut database = ConnectionState::new("test", details, ConnectionStateOptions::default(), NOW);
    touch(&mut database, vec![name(None, "a")]);
    assert!(database.catalog_updates().touched_relations.is_empty());
}

#[test]
fn touched_relations_come_back_when_the_update_fails_until_the_catalog_is_out_of_date() {
    let mut database = hyper();
    touch(&mut database, vec![name(None, "a")]);
    for attempt in 1..=MAX_TOUCHED_ATTEMPTS {
        assert!(!database.catalog_updates().is_out_of_date());
        start(&mut database, attempt, CatalogUpdateVariant::RelationRefresh);
        apply(&mut database, ConnectionAction::CatalogUpdateFailed { task_id: attempt, error: error("down") });
        assert_eq!(database.catalog_updates().touched_relations, vec![a()]);
        assert_eq!(database.catalog_updates().touched_failures, attempt);
    }
    assert!(database.catalog_updates().is_out_of_date());
    // The next statement tries again, as does an update that succeeds
    touch(&mut database, vec![name(None, "b")]);
    assert!(!database.catalog_updates().is_out_of_date());
}

#[test]
fn touched_relations_come_back_without_a_failure_when_the_update_is_cancelled() {
    let mut database = hyper();
    touch(&mut database, vec![name(None, "a")]);
    start(&mut database, 1, CatalogUpdateVariant::RelationRefresh);
    apply(&mut database, ConnectionAction::CatalogUpdateCancelled { task_id: 1, error: error("cancelled") });
    assert_eq!(database.catalog_updates().touched_relations, vec![a()]);
    assert_eq!(database.catalog_updates().touched_failures, 0);
}

#[test]
fn touched_relations_take_the_first_attached_database_of_hyper() {
    let params = ConnectionParams::new(
        ConnectorType::Hyper,
        object(json!({ "protocol": "V3_HTTP", "endpoint": "http://localhost:7484", "attachedDatabases": [{ "path": "/a.hyper", "alias": "a" }] })),
    );
    let mut database = connection(params);
    touch(&mut database, vec![name(None, "t")]);
    assert_eq!(database.catalog_updates().touched_relations, vec![RelationName::new("a", "", "t")]);
}

#[test]
fn touched_relations_take_the_default_catalog_of_trino() {
    let params = ConnectionParams::new(ConnectorType::Trino, object(json!({ "endpoint": "e", "catalogName": " hive " })));
    let mut database = connection(params);
    touch(&mut database, vec![name(Some("s"), "t")]);
    assert_eq!(database.catalog_updates().touched_relations, vec![RelationName::new("hive", "s", "t")]);
}

// Connection names and caching

#[test]
fn rename_trims_keeps_the_same_name_and_clears_a_blank_name() {
    let mut unnamed = hyper();
    apply(&mut unnamed, ConnectionAction::Rename("  Production  ".into()));
    assert_eq!(unnamed.name(), Some("Production"));
    let revision = unnamed.revision();
    let outcome = unnamed.apply(ConnectionAction::Rename("Production".into()), NOW).unwrap();
    assert!(!outcome.changed);
    assert_eq!(unnamed.revision(), revision);
    apply(&mut unnamed, ConnectionAction::Rename("   ".into()));
    assert_eq!(unnamed.name(), None);
    assert!(!hyper().apply(ConnectionAction::Rename(String::new()), NOW).unwrap().changed);
}

#[test]
fn caches_query_results_by_default_of_the_connector() {
    for (connector, caching) in [
        (ConnectorType::Hyper, false),
        (ConnectorType::Trino, true),
        (ConnectorType::SalesforceDataCloud, true),
    ] {
        let connection = connection(ConnectionParams::default_for(connector));
        assert_eq!(connection.cache_query_results(), None);
        assert_eq!(connection.caches_query_results(), caching, "{connector:?}");
    }
}

#[test]
fn keeps_the_choice_whether_a_connection_caches_query_results() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::SetQueryResultCaching(false));
    // The choice is kept also when it matches the default of the connector
    assert_eq!(connection.cache_query_results(), Some(false));
    assert!(!connection.apply(ConnectionAction::SetQueryResultCaching(false), NOW).unwrap().changed);
    apply(&mut connection, ConnectionAction::SetQueryResultCaching(true));
    assert!(connection.caches_query_results());
}

// Connector type switches

#[test]
fn switches_an_unconfigured_connection_to_another_connector() {
    let mut connection = hyper();
    assert!(!connection.apply(ConnectionAction::SwitchConnectorType(ConnectorType::Hyper), NOW).unwrap().changed);
    apply(&mut connection, ConnectionAction::SwitchConnectorType(ConnectorType::Trino));
    assert_eq!(connection.connector_type(), ConnectorType::Trino);
    assert!(connection.details().trino().is_some());
    assert_eq!(connection.params(), &ConnectionParams::default_for(ConnectorType::Trino));
}

#[test]
fn keeps_the_connector_of_a_started_connection() {
    let mut connection = hyper();
    let params = ConnectionParams::default_for(ConnectorType::Hyper).params;
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params }));
    assert!(!connection.apply(ConnectionAction::SwitchConnectorType(ConnectorType::Trino), NOW).unwrap().changed);
    assert_eq!(connection.connector_type(), ConnectorType::Hyper);
}

#[test]
fn keeps_the_connector_of_a_connection_with_a_draft() {
    let mut connection = hyper();
    let mut draft = ConnectionParams::default_for(ConnectorType::Hyper);
    draft.params.insert("endpoint".into(), json!("x"));
    apply(&mut connection, ConnectionAction::SetDraft(draft));
    assert!(!connection.apply(ConnectionAction::SwitchConnectorType(ConnectorType::Trino), NOW).unwrap().changed);
}

// Catalog updates

#[test]
fn a_refresh_is_running_only_while_the_current_full_refresh_runs() {
    let mut connection = hyper();
    assert!(!connection.catalog_updates().is_refresh_running());
    apply(&mut connection, ConnectionAction::UpdateCatalog(task(7, CatalogUpdateVariant::FullCatalogRefresh, &[])));
    assert!(connection.catalog_updates().is_refresh_running());
    // Other running tasks don't count
    apply(&mut connection, ConnectionAction::UpdateCatalog(task(8, CatalogUpdateVariant::RelationRefresh, &[])));
    apply(&mut connection, ConnectionAction::CatalogUpdateSucceeded { task_id: 7 });
    assert_eq!(connection.catalog_updates().current_full_refresh, Some(7));
    assert!(!connection.catalog_updates().is_refresh_running());
}

#[test]
fn a_catalog_can_be_refreshed_only_online_without_a_running_full_refresh() {
    let mut connection = hyper();
    assert!(!connection.can_refresh_catalog(), "not online yet");
    let params = hyper_params("a").params;
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() }));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params }));
    assert_eq!(connection.health(), ConnectionHealth::Online);
    assert!(connection.can_refresh_catalog());
    apply(&mut connection, ConnectionAction::UpdateCatalog(task(7, CatalogUpdateVariant::FullCatalogRefresh, &[])));
    assert!(!connection.can_refresh_catalog());
    apply(&mut connection, ConnectionAction::CatalogUpdateSucceeded { task_id: 7 });
    assert!(connection.can_refresh_catalog());
}

#[test]
fn a_finished_refresh_keeps_a_superseding_refresh() {
    let terminals = [
        ConnectionAction::CatalogUpdateCancelled { task_id: 7, error: error("cancelled") },
        ConnectionAction::CatalogUpdateFailed { task_id: 7, error: error("failed") },
        ConnectionAction::CatalogUpdateSucceeded { task_id: 7 },
        ConnectionAction::CatalogUpdatePartiallySucceeded { task_id: 7, error: error("partial") },
    ];
    for terminal in terminals {
        for newer_finished_first in [false, true] {
            let mut connection = hyper();
            apply(&mut connection, ConnectionAction::UpdateCatalog(task(7, CatalogUpdateVariant::FullCatalogRefresh, &[])));
            apply(&mut connection, ConnectionAction::UpdateCatalog(task(8, CatalogUpdateVariant::FullCatalogRefresh, &[])));
            if newer_finished_first {
                apply(&mut connection, ConnectionAction::CatalogUpdateSucceeded { task_id: 8 });
            }
            apply(&mut connection, terminal.clone());
            let updates = connection.catalog_updates();
            assert!(!updates.tasks_running.contains_key(&7));
            assert!(updates.tasks_finished.contains_key(&7));
            assert_eq!(updates.current_full_refresh, Some(8));
            assert_eq!(updates.is_refresh_running(), !newer_finished_first, "{terminal:?}");
            if !newer_finished_first {
                apply(&mut connection, ConnectionAction::CatalogUpdateSucceeded { task_id: 8 });
            }
            let updates = connection.catalog_updates();
            assert_eq!(updates.current_full_refresh, Some(8));
            assert!(updates.described);
            assert!(!updates.is_refresh_running());
        }
    }
}

#[test]
fn finishes_a_partially_successful_refresh() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::UpdateCatalog(task(7, CatalogUpdateVariant::FullCatalogRefresh, &[])));
    let failure = error("second: unavailable");
    apply(&mut connection, ConnectionAction::CatalogUpdatePartiallySucceeded { task_id: 7, error: failure.clone() });
    let updates = connection.catalog_updates();
    let finished = &updates.tasks_finished[&7];
    assert_eq!(finished.status, CatalogUpdateTaskStatus::PartiallySucceeded);
    assert_eq!(finished.error, Some(failure));
    assert_eq!(finished.finished_at, Some(NOW));
    assert!(!updates.tasks_running.contains_key(&7));
    // A partial catalog doesn't describe the connection
    assert!(!updates.described);
}

#[test]
fn registers_the_queries_of_running_updates_only() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::UpdateCatalog(task(7, CatalogUpdateVariant::FullCatalogRefresh, &[])));
    apply(&mut connection, ConnectionAction::CatalogUpdateRegisterQuery { task_id: 7, query_id: 3 });
    assert_eq!(connection.catalog_updates().tasks_running[&7].queries, vec![3]);
    let outcome = connection.apply(ConnectionAction::CatalogUpdateRegisterQuery { task_id: 9, query_id: 4 }, NOW).unwrap();
    assert!(!outcome.changed);
    assert!(!connection.apply(ConnectionAction::CatalogUpdateSucceeded { task_id: 9 }, NOW).unwrap().changed);
}

// Drafts and the params of a setup

fn hyper_params(endpoint: &str) -> ConnectionParams {
    let mut params = ConnectionParams::default_for(ConnectorType::Hyper);
    params.params.insert("endpoint".into(), json!(endpoint));
    params
}

fn with_draft_rows(mut params: ConnectionParams) -> ConnectionParams {
    params.params.insert("draftRows".into(), json!({ "metadata": [{ "key": "k", "value": "" }] }));
    params
}

#[test]
fn sets_a_draft_of_the_same_connector_only() {
    let mut connection = hyper();
    assert!(!connection.apply(ConnectionAction::SetDraft(ConnectionParams::default_for(ConnectorType::Trino)), NOW).unwrap().changed);
    apply(&mut connection, ConnectionAction::SetDraft(hyper_params("a")));
    assert_eq!(connection.params_draft(), Some(&hyper_params("a")));
    assert!(!connection.apply(ConnectionAction::SetDraft(hyper_params("a")), NOW).unwrap().changed);
}

#[test]
fn commits_saved_params_and_drops_the_draft_unless_it_changed() {
    let mut connection = hyper();
    let draft = with_draft_rows(hyper_params("a"));
    apply(&mut connection, ConnectionAction::SetDraft(draft.clone()));
    apply(&mut connection, ConnectionAction::CommitParams(draft));
    assert_eq!(connection.params(), &hyper_params("a"));
    assert_eq!(connection.params_draft(), None);
    assert!(!connection.apply(ConnectionAction::CommitParams(hyper_params("a")), NOW).unwrap().changed);

    // The draft changed while saving
    apply(&mut connection, ConnectionAction::SetDraft(hyper_params("b")));
    apply(&mut connection, ConnectionAction::CommitParams(hyper_params("c")));
    assert_eq!(connection.params(), &hyper_params("c"));
    assert_eq!(connection.params_draft(), Some(&hyper_params("b")));
    assert!(!connection.apply(ConnectionAction::CommitParams(hyper_params("c")), NOW).unwrap().changed);
}

#[test]
fn an_embedded_hyper_is_online_with_its_channel_and_commits_the_params_of_the_setup() {
    let mut connection = hyper();
    assert!(!connection.active());
    let draft = with_draft_rows(hyper_params("a"));
    apply(&mut connection, ConnectionAction::SetDraft(draft.clone()));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: draft.params.clone() }));
    assert_eq!(connection.setup_attempt_params(), Some(&draft));
    assert_eq!(connection.setup_attempt_draft(), Some(&draft));
    assert_eq!(connection.health(), ConnectionHealth::Connecting);

    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params: draft.params.clone() }));
    assert_eq!(connection.status(), ConnectionStatus::ChannelReady);
    assert_eq!(connection.health(), ConnectionHealth::Online);
    assert!(connection.active());
    assert_eq!(connection.details().channel, Some(ConnectionChannel::Host(1)));
    assert_eq!(connection.details().setup_timings.channel_ready_at, Some(NOW));
    // The raw form rows stay in the draft, which the setup settled
    assert_eq!(connection.params(), &hyper_params("a"));
    assert_eq!(connection.params_draft(), None);
    assert_eq!(connection.setup_attempt_params(), None);
    assert_eq!(connection.setup_attempt_draft(), None);
}

#[test]
fn a_hyper_server_waits_for_the_health_check() {
    let mut connection = hyper();
    let mut params = hyper_params("http://localhost:7484");
    params.params.insert("protocol".into(), json!("V3_HTTP"));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.params.clone() }));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params: params.params.clone() }));
    assert_eq!(connection.health(), ConnectionHealth::Connecting);
    assert!(!connection.active());
    assert_eq!(connection.params(), &ConnectionParams::default_for(ConnectorType::Hyper));
    apply(&mut connection, ConnectionAction::HealthCheckStarted);
    assert_eq!(connection.status(), ConnectionStatus::HealthCheckStarted);
    assert_eq!(connection.details().setup_timings.health_check_started_at, Some(NOW));
    apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
    assert_eq!(connection.status(), ConnectionStatus::HealthCheckSucceeded);
    assert_eq!(connection.health(), ConnectionHealth::Online);
    assert!(connection.active());
    assert_eq!(connection.params(), &params);
}

#[test]
fn a_draft_that_changed_during_the_setup_stays() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::SetDraft(hyper_params("a")));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: hyper_params("a").params }));
    apply(&mut connection, ConnectionAction::SetDraft(hyper_params("b")));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params: hyper_params("a").params }));
    assert_eq!(connection.params(), &hyper_params("a"));
    assert_eq!(connection.params_draft(), Some(&hyper_params("b")));
}

#[test]
fn a_failed_setup_forgets_its_params() {
    let mut connection = hyper();
    let initial = connection.params().clone();
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: hyper_params("a").params }));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error("refused"))));
    assert_eq!(connection.health(), ConnectionHealth::Failed);
    assert_eq!(connection.details().channel_error, Some(error("refused")));
    assert_eq!(connection.setup_attempt_params(), None);
    assert_eq!(connection.params(), &initial);
    assert!(!connection.active());
}

#[test]
fn a_hyper_channel_setup_that_is_cancelled_keeps_the_error() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: hyper_params("a").params }));
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(error("cancelled"))));
    assert_eq!(connection.status(), ConnectionStatus::ChannelSetupCancelled);
    assert_eq!(connection.health(), ConnectionHealth::Cancelled);
    assert_eq!(connection.details().channel_error, Some(error("cancelled")));
    assert_eq!(connection.setup_attempt_params(), None);
}

#[test]
fn discarding_the_draft_drops_the_errors_unless_the_connection_is_connecting() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::SetDraft(hyper_params("a")));
    apply(&mut connection, ConnectionAction::HealthCheckFailed(error("down")));
    assert_eq!(connection.status(), ConnectionStatus::HealthCheckFailed);
    assert_eq!(connection.details().health_check_error, Some(error("down")));
    assert_eq!(connection.details().setup_timings.health_check_failed_at, Some(NOW));

    apply(&mut connection, ConnectionAction::HealthCheckStarted);
    assert!(!connection.apply(ConnectionAction::DiscardDraft, NOW).unwrap().changed);
    assert!(connection.params_draft().is_some());

    apply(&mut connection, ConnectionAction::HealthCheckCancelled);
    assert_eq!(connection.health(), ConnectionHealth::Cancelled);
    assert_eq!(connection.details().setup_timings.health_check_cancelled_at, Some(NOW));
    apply(&mut connection, ConnectionAction::DiscardDraft);
    assert_eq!(connection.params_draft(), None);
    assert_eq!(connection.details().health_check_error, None);
    assert!(!connection.apply(ConnectionAction::DiscardDraft, NOW).unwrap().changed);
}

#[test]
fn reset_closes_the_channel_and_keeps_the_setup_params() {
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(5), params: hyper_params("a").params }));
    let effects = apply(&mut connection, ConnectionAction::Reset);
    assert_eq!(effects.last(), Some(&ConnectionEffect::Close { handle: 5 }));
    assert!(connection.details().channel.is_none());
    assert_eq!(connection.details().setup_timings, SetupTimings::default());
    assert_eq!(connection.details().setup_params, Some(hyper_params("a").params));
    // A connection that was online stays active
    assert!(connection.active());
}

#[test]
fn an_update_that_replaces_one_of_the_same_id_releases_its_handle() {
    let mut database = hyper();
    apply(&mut database, ConnectionAction::UpdateCatalog(task(0, CatalogUpdateVariant::FullCatalogRefresh, &[])));
    let again = CatalogUpdateTask { handle: Some(200), ..task(0, CatalogUpdateVariant::FullCatalogRefresh, &[]) };
    assert_eq!(apply(&mut database, ConnectionAction::UpdateCatalog(again)), vec![ConnectionEffect::Release { handle: 100 }]);
    assert_eq!(database.catalog_updates().tasks_running[&0].handle, Some(200));
}

#[test]
fn a_new_setup_closes_the_channel_that_it_replaces() {
    // The connection owns its channels of the host, e.g. the session of the embedded Hyper of a shell that mounts again
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params: hyper_params("a").params }));
    let effects = apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: hyper_params("a").params }));
    assert_eq!(effects, vec![ConnectionEffect::Close { handle: 1 }]);
    assert!(connection.details().channel.is_none());
    // A channel that replaces another one closes it as well
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(2), params: hyper_params("a").params }));
    let effects = apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(3), params: hyper_params("a").params }));
    assert_eq!(effects, vec![ConnectionEffect::Close { handle: 2 }]);
    // A salesforce connection that sets up again closes the channel of the host as well, a switch of the connector too
    let mut connection = hyper();
    apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(4), params: hyper_params("a").params }));
    let effects = apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error("boom"))));
    assert_eq!(effects, vec![ConnectionEffect::Close { handle: 4 }]);
}

// Connection params

#[test]
fn reads_and_writes_connection_params_as_json() {
    let params = ConnectionParams::from_json(r#"{"trino": {"endpoint": "e", "auth": {"authType": "AUTH_BASIC"}}}"#).unwrap();
    assert_eq!(params.connector, ConnectorType::Trino);
    // The order of the keys doesn't matter
    let reordered = ConnectionParams::from_json(r#"{"trino": {"auth": {"authType": "AUTH_BASIC"}, "endpoint": "e"}}"#).unwrap();
    assert_eq!(params, reordered);
    assert_eq!(ConnectionParams::from_json(&params.to_json()).unwrap(), params);
    assert!(ConnectionParams::from_json(r#"{"other": {}}"#).is_err());
    assert!(ConnectionParams::from_json(r#"{"hyper": 1}"#).is_err());
    assert!(ConnectionParams::from_json("[").is_err());
}

#[test]
fn trino_session_defaults_need_a_catalog() {
    let defaults = |params: serde_json::Value| trino_session_defaults(&object(params));
    assert_eq!(defaults(json!({})), TrinoSessionDefaults::default());
    assert_eq!(defaults(json!({ "defaultSchema": "s" })), TrinoSessionDefaults::default());
    assert_eq!(
        defaults(json!({ "defaultCatalog": "c", "defaultSchema": " " })),
        TrinoSessionDefaults { catalog: Some("c".into()), schema: None }
    );
    // The default catalog replaced the catalog name
    assert_eq!(
        defaults(json!({ "defaultCatalog": "c", "catalogName": "old", "defaultSchema": "s" })),
        TrinoSessionDefaults { catalog: Some("c".into()), schema: Some("s".into()) }
    );
}

// Trino

type Timing = fn(&SetupTimings) -> Option<Timestamp>;

fn timing(timing: Timing) -> Timing {
    timing
}

/// The ready step of a Trino setup with a channel of the params
fn trino_ready() -> TrinoAction {
    let trino = dashql_core_runtime::trino::SharedTrinoChannel::new(dashql_core_runtime::trino::TrinoChannel::from_params(&trino_params()));
    TrinoAction::ChannelReady(trino)
}

fn trino_params() -> JsonObject {
    object(json!({ "endpoint": "https://trino.example.com", "auth": { "authType": "AUTH_OAUTH" }, "catalogName": "hive" }))
}

fn trino() -> ConnectionState {
    connection(ConnectionParams::new(ConnectorType::Trino, trino_params()))
}

/// When the code of a flow arrived
const CODE_RECEIVED_AT: &str = "2026-01-01T00:00:00.000Z";

fn trino_oauth(connection: &ConnectionState) -> Option<&TrinoOAuthState> {
    connection.details().trino().unwrap().oauth_state.as_ref()
}

#[test]
fn trino_actions_set_the_status_health_and_timing() {
    use ConnectionHealth as H;
    use ConnectionStatus as S;
    let cases: Vec<(TrinoAction, S, H, Timing)> = vec![
        (TrinoAction::OAuthStarted { params: trino_params() }, S::AuthStarted, H::Connecting, timing(|t| t.oauth_started_at)),
        (TrinoAction::OAuthCancelled(error("boom")), S::AuthCancelled, H::Cancelled, timing(|t| t.oauth_cancelled_at)),
        (TrinoAction::OAuthFailed(error("boom")), S::AuthFailed, H::Failed, timing(|t| t.oauth_failed_at)),
        (TrinoAction::GeneratingPkceChallenge, S::PkceGenerationStarted, H::Connecting, timing(|t| t.pkce_gen_started_at)),
        (TrinoAction::GeneratedPkceChallenge, S::PkceGenerated, H::Connecting, timing(|t| t.pkce_gen_finished_at)),
        (TrinoAction::OAuthBrowserOpened, S::WaitingForOAuthCodeViaLink, H::Connecting, timing(|t| t.oauth_browser_opened_at)),
        (TrinoAction::ReceivedOAuthCode { created_at: CODE_RECEIVED_AT.into() }, S::OAuthCodeReceived, H::Connecting, timing(|t| t.oauth_code_received_at)),
        (TrinoAction::RequestingAccessToken, S::AccessTokenRequested, H::Connecting, timing(|t| t.access_token_requested_at)),
        (
            TrinoAction::ReceivedAccessToken,
            S::AccessTokenReceived,
            H::Connecting,
            timing(|t| t.access_token_received_at),
        ),
        (
            TrinoAction::ChannelSetupStarted { params: trino_params() },
            S::ChannelSetupStarted,
            H::Connecting,
            timing(|t| t.channel_setup_started_at),
        ),
        (
            TrinoAction::ChannelSetupCancelled(error("boom")),
            S::ChannelSetupCancelled,
            H::Cancelled,
            timing(|t| t.channel_setup_cancelled_at),
        ),
        (TrinoAction::ChannelSetupFailed(error("boom")), S::ChannelSetupFailed, H::Failed, timing(|t| t.channel_setup_failed_at)),
        (trino_ready(), S::ChannelReady, H::Connecting, timing(|t| t.channel_ready_at)),
    ];
    for (action, status, health, timing) in cases {
        let mut connection = trino();
        apply(&mut connection, ConnectionAction::Trino(action.clone()));
        assert_eq!(connection.status(), status, "{action:?}");
        assert_eq!(connection.health(), health, "{action:?}");
        assert_eq!(timing(&connection.details().setup_timings), Some(NOW), "{action:?}");
    }
}

#[test]
fn trino_collects_the_oauth_state_of_the_steps() {
    let mut connection = trino();
    for action in [
        TrinoAction::OAuthStarted { params: trino_params() },
        TrinoAction::GeneratedPkceChallenge,
        TrinoAction::ReceivedOAuthCode { created_at: CODE_RECEIVED_AT.into() },
        TrinoAction::ReceivedAccessToken,
    ] {
        apply(&mut connection, ConnectionAction::Trino(action));
    }
    // The verifier, the code and the token never reach the connection
    assert_eq!(trino_oauth(&connection), Some(&TrinoOAuthState { pkce_generated: true, auth_code_received_at: Some(CODE_RECEIVED_AT.into()) }));
}

#[test]
fn trino_stores_the_channel_error_and_clears_it_on_the_next_channel_setup() {
    let mut connection = trino();
    apply(&mut connection, ConnectionAction::Trino(TrinoAction::ChannelSetupFailed(error("boom"))));
    assert_eq!(connection.details().channel_error, Some(error("boom")));
    apply(&mut connection, ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: trino_params() }));
    assert_eq!(connection.details().channel_error, None);
}

#[test]
fn trino_reset_and_delete_drop_the_channel_and_clear_the_setup() {
    for stop in [ConnectionAction::Reset, ConnectionAction::Delete] {
        let mut connection = trino();
        let initial = connection.details().clone();
        apply(&mut connection, ConnectionAction::Trino(TrinoAction::OAuthStarted { params: trino_params() }));
        apply(&mut connection, ConnectionAction::Trino(trino_ready()));
        assert!(matches!(connection.details().channel, Some(ConnectionChannel::Trino(_))));

        // The connection owns the channel, no handle of the host closes
        let effects = apply(&mut connection, stop);
        assert!(!effects.iter().any(|effect| matches!(effect, ConnectionEffect::Close { .. })));
        assert!(connection.details().channel.is_none());
        assert_eq!(connection.details(), &initial);
    }
}

/// A step of a setup attempt
fn step(epoch: u64, action: ConnectionAction) -> ConnectionAction {
    ConnectionAction::SetupStep { epoch, step: Box::new(action) }
}

#[test]
fn a_setup_ignores_the_steps_of_the_attempt_that_it_replaced() {
    let mut connection = hyper();
    let params = hyper_params("a").params;
    let started = || ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() });
    let ready = |handle| ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(handle), params: params.clone() });
    let handle = |connection: &ConnectionState| connection.details().channel.as_ref().and_then(ConnectionChannel::host_handle);
    // The first setup is stuck connecting, a second one replaces it and succeeds
    let first = connection.begin_setup();
    apply(&mut connection, step(first, started()));
    let second = connection.begin_setup();
    apply(&mut connection, step(second, started()));
    apply(&mut connection, step(second, ready(5)));
    apply(&mut connection, step(second, ConnectionAction::HealthCheckSucceeded));
    assert_eq!((connection.health(), handle(&connection)), (ConnectionHealth::Online, Some(5)));
    let revision = connection.revision();

    // The first setup ends late: its cancellation changes nothing, its channel belongs to no connection and is closed
    let effects = apply(&mut connection, step(first, ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(error("cancelled")))));
    assert!(effects.is_empty());
    let effects = apply(&mut connection, step(first, ready(6)));
    assert_eq!(effects, [ConnectionEffect::Close { handle: 6 }]);
    assert_eq!((connection.health(), handle(&connection)), (ConnectionHealth::Online, Some(5)));
    assert_eq!(connection.revision(), revision);
    // The late ready step of Trino hands no handle, its channel goes with the step
    let mut connection = trino();
    let first = connection.begin_setup();
    connection.begin_setup();
    assert!(apply(&mut connection, step(first, ConnectionAction::Trino(trino_ready()))).is_empty());
    assert!(connection.details().channel.is_none());
}

#[test]
fn a_reset_or_delete_ignores_the_late_steps_of_the_setup() {
    for stop in [ConnectionAction::Reset, ConnectionAction::Delete] {
        let mut connection = trino();
        let attempt = connection.begin_setup();
        apply(&mut connection, step(attempt, ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: trino_params() })));
        apply(&mut connection, step(attempt, ConnectionAction::Trino(trino_ready())));
        apply(&mut connection, step(attempt, ConnectionAction::HealthCheckStarted));
        let effects = apply(&mut connection, stop.clone());
        assert!(effects.contains(&ConnectionEffect::CancelSetup));
        // The probe of the health check ends after the stop, the setup reports its cancellation
        apply(&mut connection, step(attempt, ConnectionAction::HealthCheckCancelled));
        apply(&mut connection, step(attempt, ConnectionAction::Trino(TrinoAction::ChannelSetupCancelled(error("cancelled")))));
        assert_eq!((connection.status(), connection.health()), (ConnectionStatus::NotStarted, ConnectionHealth::NotStarted));
        assert_eq!(connection.details().setup_timings, SetupTimings::default());
    }
}

#[test]
fn a_failed_token_refresh_fails_the_connection_that_is_online() {
    let mut connection = trino();
    apply(&mut connection, ConnectionAction::Trino(trino_ready()));
    apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
    assert_eq!(connection.health(), ConnectionHealth::Online);
    apply(&mut connection, ConnectionAction::TokenRefreshFailed(error("The refresh of the access token timed out")));
    assert_eq!((connection.status(), connection.health()), (ConnectionStatus::AuthFailed, ConnectionHealth::Failed));
    assert_eq!(connection.details().channel_error, Some(error("The refresh of the access token timed out")));
    assert!(!connection.can_refresh_catalog());
    // A refresh that ends after the connection went offline changes nothing
    let mut connection = trino();
    let revision = connection.revision();
    assert!(!connection.apply(ConnectionAction::TokenRefreshFailed(error("late")), NOW).unwrap().changed);
    assert_eq!((connection.health(), connection.revision()), (ConnectionHealth::NotStarted, revision));
}

#[test]
fn trino_channel_setup_after_oauth_continues_the_attempt_of_the_flow() {
    let mut connection = trino();
    let draft = |endpoint: &str| {
        let mut params = ConnectionParams::new(ConnectorType::Trino, trino_params());
        params.params.insert("endpoint".into(), json!(endpoint));
        params
    };
    apply(&mut connection, ConnectionAction::SetDraft(draft("first")));
    apply(&mut connection, ConnectionAction::Trino(TrinoAction::OAuthStarted { params: draft("first").params }));
    apply(&mut connection, ConnectionAction::SetDraft(draft("second")));
    apply(&mut connection, ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: draft("first").params }));
    assert_eq!(connection.setup_attempt_draft(), Some(&draft("first")));
    apply(&mut connection, ConnectionAction::Trino(trino_ready()));
    apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
    assert_eq!(connection.params(), &draft("first"));
    // The draft changed during the setup
    assert_eq!(connection.params_draft(), Some(&draft("second")));
}

#[test]
fn trino_refuses_other_actions_and_other_connections_have_no_trino_details() {
    let mut connection = trino();
    let details = connection.details().clone();
    let revision = connection.revision();
    let action = ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params: hyper_params("a").params });
    assert!(connection.apply(action, NOW).is_err());
    assert!(connection.apply(ConnectionAction::Salesforce(SalesforceAction::GeneratingPkceChallenge), NOW).is_err());
    assert_eq!(connection.details(), &details);
    assert_eq!(connection.revision(), revision);
    assert_eq!(connection.status(), ConnectionStatus::NotStarted);
    assert!(hyper().details().trino().is_none());
}

// Salesforce

fn salesforce_params() -> JsonObject {
    object(json!({
        "instanceUrl": "https://example.my.salesforce.com",
        "appConsumerKey": "consumer-key",
        "appConsumerSecret": "",
        "login": "",
    }))
}

fn salesforce_of(connector: ConnectorType) -> ConnectionState {
    connection(ConnectionParams::new(connector, salesforce_params()))
}

fn salesforce() -> ConnectionState {
    salesforce_of(ConnectorType::SalesforceDataCloud)
}

fn salesforce_login(connection: &ConnectionState) -> Option<&str> {
    connection.details().setup_params.as_ref().and_then(|params| params.get("login")).and_then(|login| login.as_str())
}

fn user_info(preferred_username: Option<&str>, email: Option<&str>) -> ConnectionAction {
    ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreUserInfo {
        preferred_username: preferred_username.map(str::to_string),
        email: email.map(str::to_string),
    })
}

/// The channel of a Salesforce login with its tokens
fn salesforce_channel() -> dashql_core_runtime::salesforce::SharedSalesforceChannel {
    use dashql_core_runtime::salesforce::{
        SalesforceConnectionParams, SalesforceCoreAccessToken, SalesforceDataCloudAccessToken, SalesforceTokens, SharedSalesforceChannel,
    };
    let core = SalesforceCoreAccessToken {
        access_token: "core".into(),
        refresh_token: Some("refresh".into()),
        instance_url: Some("https://example.my.salesforce.com".into()),
        ..Default::default()
    };
    let data_cloud = SalesforceDataCloudAccessToken { instance_url: "https://tenant.c360a.salesforce.com/".into(), ..Default::default() };
    let params = SalesforceConnectionParams::default();
    SharedSalesforceChannel::new(ConnectorType::SalesforceDataCloud, &params, SalesforceTokens { core, data_cloud }).unwrap()
}

#[test]
fn salesforce_actions_set_the_status_health_and_timing() {
    use ConnectionHealth as H;
    use ConnectionStatus as S;
    use SalesforceAction as A;
    let cases: Vec<(SalesforceAction, S, H, Timing)> = vec![
        (A::SetupStarted { params: salesforce_params() }, S::AuthStarted, H::Connecting, timing(|t| t.auth_started_at)),
        (A::SetupCancelled(error("boom")), S::AuthCancelled, H::Cancelled, timing(|t| t.auth_cancelled_at)),
        (A::SetupFailed(error("boom")), S::AuthFailed, H::Failed, timing(|t| t.auth_failed_at)),
        (A::GeneratingPkceChallenge, S::PkceGenerationStarted, H::Connecting, timing(|t| t.pkce_gen_started_at)),
        (A::GeneratedPkceChallenge, S::PkceGenerated, H::Connecting, timing(|t| t.pkce_gen_finished_at)),
        (A::OAuthNativeLinkOpened, S::WaitingForOAuthCodeViaLink, H::Connecting, timing(|t| t.opened_native_auth_link_at)),
        (A::OAuthWebWindowOpened, S::WaitingForOAuthCodeViaWindow, H::Connecting, timing(|t| t.opened_web_auth_window_at)),
        (A::OAuthWebWindowClosed, S::NotStarted, H::NotStarted, timing(|t| t.closed_web_auth_window_at)),
        (A::ReceivedCoreAuthCode { created_at: CODE_RECEIVED_AT.into() }, S::OAuthCodeReceived, H::Connecting, timing(|t| t.oauth_code_received_at)),
        (A::RequestingCoreAuthToken, S::AccessTokenRequested, H::Connecting, timing(|t| t.core_access_token_requested_at)),
        (
            A::ReceivedCoreAuthToken,
            S::CoreAccessTokenReceived,
            H::Connecting,
            timing(|t| t.core_access_token_received_at),
        ),
        (
            A::RequestingDataCloudAccessToken,
            S::DataCloudTokenRequested,
            H::Connecting,
            timing(|t| t.data_cloud_access_token_requested_at),
        ),
        (
            A::ReceivedDataCloudAccessToken,
            S::DataCloudTokenReceived,
            H::Connecting,
            timing(|t| t.data_cloud_access_token_received_at),
        ),
        (A::ChannelSetupStarted, S::ChannelSetupStarted, H::Connecting, timing(|t| t.channel_setup_started_at)),
        (A::ChannelSetupCancelled(error("boom")), S::ChannelSetupCancelled, H::Cancelled, timing(|t| t.channel_setup_cancelled_at)),
        (A::ChannelSetupFailed(error("boom")), S::ChannelSetupFailed, H::Failed, timing(|t| t.channel_setup_failed_at)),
        (A::ChannelReady(salesforce_channel()), S::ChannelReady, H::Connecting, timing(|t| t.channel_ready_at)),
    ];
    for (action, status, health, timing) in cases {
        let mut connection = salesforce();
        apply(&mut connection, ConnectionAction::Salesforce(action.clone()));
        assert_eq!(connection.status(), status, "{action:?}");
        assert_eq!(connection.health(), health, "{action:?}");
        assert_eq!(timing(&connection.details().setup_timings), Some(NOW), "{action:?}");
    }
}

#[test]
fn salesforce_collects_the_oauth_state_of_the_steps() {
    let mut connection = salesforce();
    apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: salesforce_params() }));
    let oauth_params = connection.details().salesforce().unwrap().oauth_state.as_ref().unwrap().oauth_params.clone().unwrap();
    assert_eq!(oauth_params.instance_url, "https://example.my.salesforce.com");
    assert_eq!(oauth_params.app_consumer_key, "consumer-key");
    assert_eq!(oauth_params.expires_at - oauth_params.requested_at, 2.0 * 60.0 * 60.0 * 1000.0);

    for action in [
        SalesforceAction::GeneratedPkceChallenge,
        SalesforceAction::ReceivedCoreAuthCode { created_at: CODE_RECEIVED_AT.into() },
        SalesforceAction::ReceivedCoreAuthToken,
        SalesforceAction::ReceivedDataCloudAccessToken,
    ] {
        apply(&mut connection, ConnectionAction::Salesforce(action));
    }
    // The verifier, the code and the tokens never reach the connection, the channel brings the tokens
    assert_eq!(
        connection.details().salesforce().unwrap().oauth_state,
        Some(SalesforceOAuthState {
            oauth_params: Some(oauth_params),
            pkce_generated: true,
            core_auth_code_received_at: Some(CODE_RECEIVED_AT.into()),
        })
    );
    assert!(connection.details().channel.is_none());
}

#[test]
fn salesforce_stores_the_login_of_the_user_info_the_username_before_the_email() {
    let principal = |connection: &ConnectionState| connection.details().salesforce().unwrap().principal.clone();
    let mut by_username = salesforce();
    apply(&mut by_username, user_info(Some("user@example.com"), Some("mail@example.com")));
    assert_eq!(salesforce_login(&by_username), Some("user@example.com"));
    assert_eq!(principal(&by_username).as_deref(), Some("user@example.com"));
    let mut by_email = salesforce();
    apply(&mut by_email, user_info(None, Some("mail@example.com")));
    assert_eq!(salesforce_login(&by_email), Some("mail@example.com"));
    // User info without an account keeps the login hint, but names no principal
    apply(&mut by_email, user_info(None, None));
    assert_eq!(salesforce_login(&by_email), Some("mail@example.com"));
    assert_eq!(principal(&by_email), None);
}

#[test]
fn salesforce_keeps_the_details_type_of_database_com_connections() {
    let mut connection = salesforce_of(ConnectorType::Dbcom);
    apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: salesforce_params() }));
    assert_eq!(connection.connector_type(), ConnectorType::Dbcom);
    assert!(matches!(connection.details().connector, ConnectorDetails::Dbcom(_)));
    assert_eq!(connection.setup_attempt_params().map(|params| params.connector), Some(ConnectorType::Dbcom));
}

#[test]
fn salesforce_reset_and_delete_close_the_channel_and_clear_the_setup() {
    for stop in [ConnectionAction::Reset, ConnectionAction::Delete] {
        let mut connection = salesforce();
        apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: salesforce_params() }));
        apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::GeneratedPkceChallenge));
        apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreAuthCode { created_at: CODE_RECEIVED_AT.into() }));
        apply(&mut connection, user_info(Some("user@example.com"), None));
        apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::SetupFailed(error("boom"))));
        apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::ChannelReady(salesforce_channel())));
        assert!(matches!(connection.details().channel, Some(ConnectionChannel::Salesforce(_))));

        // The channel goes with its tokens, the OAuth flow and the account of the login are forgotten
        apply(&mut connection, stop);
        assert!(connection.details().channel.is_none());
        assert_eq!(connection.details().setup_timings, SetupTimings::default());
        let salesforce = connection.details().salesforce().unwrap();
        assert_eq!(salesforce.setup_error, None);
        assert_eq!(salesforce.oauth_state, None);
        assert_eq!(salesforce.principal, None);
    }
}

#[test]
fn salesforce_online_keeps_the_login_that_the_user_info_resolved() {
    let mut connection = salesforce();
    apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: salesforce_params() }));
    apply(&mut connection, user_info(Some("user@example.com"), None));
    apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::ChannelReady(salesforce_channel())));
    apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
    assert_eq!(connection.health(), ConnectionHealth::Online);
    let mut expected = salesforce_params();
    expected.insert("login".into(), json!("user@example.com"));
    assert_eq!(connection.params(), &ConnectionParams::new(ConnectorType::SalesforceDataCloud, expected));
}

#[test]
fn salesforce_refuses_other_actions_and_other_connections_have_no_salesforce_details() {
    let mut connection = salesforce();
    assert!(connection.apply(ConnectionAction::Trino(TrinoAction::GeneratingPkceChallenge), NOW).is_err());
    assert_eq!(connection.revision(), 0);
    assert!(hyper().details().salesforce().is_none());
}

#[test]
fn health_and_its_label() {
    assert!(ConnectionHealth::Connecting.is_open());
    assert!(ConnectionHealth::Online.is_open());
    assert!(!ConnectionHealth::Failed.is_open());
    assert_eq!(ConnectionHealth::NotStarted.to_string(), "Not Started");
}

#[test]
fn restoring_the_catalog_updates_and_the_function_script_text() {
    let mut connection = hyper();
    let revision = connection.revision();
    let relation = RelationName::new("hyper", "public", "t");
    connection.restore_catalog_updates(Some(true), Some(vec![relation.clone()]));
    assert!(connection.catalog_updates().described);
    assert_eq!(connection.catalog_updates().touched_relations, vec![relation]);
    assert!(connection.revision() > revision);
    connection.replace_function_script_text("CREATE FUNCTION f() RETURNS int;").unwrap();
    assert_eq!(connection.function_script().unwrap().to_text(), "CREATE FUNCTION f() RETURNS int;");
    apply(&mut connection, ConnectionAction::Delete);
    assert!(connection.replace_function_script_text("").is_err());
}

#[test]
fn connections_take_the_catalog_of_the_caller() {
    let entry_ids = dashql_core::catalog::EntryIdSource::new();
    let other = dashql_core::catalog::Catalog::with_entry_ids(entry_ids.clone());
    let taken = other.allocate_entry_id();
    let params = ConnectionParams::default_for(ConnectorType::Hyper);
    let connection = ConnectionState::with_catalog(
        "test",
        ConnectionDetails::new(&params),
        ConnectionStateOptions::default(),
        NOW,
        dashql_core::catalog::Catalog::with_entry_ids(entry_ids),
    );
    // The entry ids of the connection come from the shared source
    assert_ne!(connection.relation_entry_id(), taken);
    assert_ne!(function_entry_id(&connection), taken);
}

// The drafts of the setups of every connector, ported from `connection_draft.test.tsx` of the app

/// The params of a connector with an edited endpoint
fn edited(connector: ConnectorType, endpoint: &str) -> ConnectionParams {
    let mut params = ConnectionParams::default_for(connector);
    match connector {
        ConnectorType::Hyper => {
            params.params.insert("protocol".into(), json!("V3_HTTP"));
            params.params.insert("endpoint".into(), json!(endpoint));
        }
        ConnectorType::Trino => {
            params.params.insert("endpoint".into(), json!(endpoint));
        }
        ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => {
            params.params.insert("instanceUrl".into(), json!(endpoint));
        }
    }
    params
}

/// The start of the setup of a connector with params
fn setup_started(params: &ConnectionParams) -> ConnectionAction {
    let inner = params.params.clone();
    match params.connector {
        ConnectorType::Hyper => ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: inner }),
        ConnectorType::Trino => ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: inner }),
        ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => {
            ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: inner })
        }
    }
}

/// The failure or the cancellation of the setup of a connector
fn setup_ended(connector: ConnectorType, cancelled: bool) -> ConnectionAction {
    let error = error(if cancelled { "setup cancelled" } else { "setup failed" });
    match (connector, cancelled) {
        (ConnectorType::Hyper, false) => ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error)),
        (ConnectorType::Hyper, true) => ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(error)),
        (ConnectorType::Trino, false) => ConnectionAction::Trino(TrinoAction::ChannelSetupFailed(error)),
        (ConnectorType::Trino, true) => ConnectionAction::Trino(TrinoAction::ChannelSetupCancelled(error)),
        (_, false) => ConnectionAction::Salesforce(SalesforceAction::SetupFailed(error)),
        (_, true) => ConnectionAction::Salesforce(SalesforceAction::SetupCancelled(error)),
    }
}

#[test]
fn every_connector_keeps_its_params_until_the_health_check_succeeds() {
    for connector in CONNECTOR_TYPES {
        let mut connection = connection(ConnectionParams::default_for(connector));
        let committed = connection.params().clone();
        let draft = edited(connector, "https://invalid");
        apply(&mut connection, ConnectionAction::SetDraft(draft.clone()));
        apply(&mut connection, setup_started(&draft));
        assert_eq!(connection.params(), &committed, "{connector:?}");
        assert_eq!(connection.params_draft(), Some(&draft));
        // A discard while the setup runs keeps the draft
        assert!(!connection.apply(ConnectionAction::DiscardDraft, NOW).unwrap().changed);
        let newer = edited(connector, "https://newer");
        apply(&mut connection, ConnectionAction::SetDraft(newer.clone()));
        apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
        assert_eq!(connection.params(), &draft, "{connector:?}");
        assert_eq!(connection.params_draft(), Some(&newer));
        apply(&mut connection, setup_started(&newer));
        apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
        assert_eq!(connection.params(), &newer);
        assert_eq!(connection.params_draft(), None);
    }
}

#[test]
fn every_connector_keeps_the_draft_and_the_params_of_a_setup_that_ends_otherwise() {
    for connector in CONNECTOR_TYPES {
        let draft = edited(connector, "https://invalid");
        let mut started = connection(ConnectionParams::default_for(connector));
        let initial = started.params().clone();
        apply(&mut started, ConnectionAction::SetDraft(draft.clone()));
        apply(&mut started, setup_started(&draft));
        for action in [
            setup_ended(connector, false),
            setup_ended(connector, true),
            ConnectionAction::HealthCheckFailed(error("failed")),
            ConnectionAction::HealthCheckCancelled,
            ConnectionAction::Reset,
        ] {
            let mut next = connection(ConnectionParams::default_for(connector));
            apply(&mut next, ConnectionAction::SetDraft(draft.clone()));
            apply(&mut next, setup_started(&draft));
            apply(&mut next, action);
            assert_eq!(next.params(), &initial, "{connector:?}");
            assert_eq!(next.params_draft(), Some(&draft), "{connector:?}");
            assert_eq!(next.setup_attempt_params(), None, "{connector:?}");
        }
        apply(&mut started, ConnectionAction::HealthCheckFailed(error("failed")));
        apply(&mut started, ConnectionAction::DiscardDraft);
        assert_eq!(started.params_draft(), None);
        assert_eq!(started.params(), &initial);
        assert_eq!(started.details().health_check_error, None);
    }
}

#[test]
fn edits_of_the_raw_rows_during_a_setup_stay_and_the_promoted_params_drop_them() {
    let mut connection = hyper();
    let mut initial = edited(ConnectorType::Hyper, "https://hyper");
    initial.params.insert("metadata".into(), json!({ "duplicate": "same" }));
    initial.params.insert("draftRows".into(), json!({ "metadata": [{ "key": "duplicate", "value": "same" }] }));
    apply(&mut connection, ConnectionAction::SetDraft(initial.clone()));
    apply(&mut connection, setup_started(&initial));
    let mut newer = initial.clone();
    newer.params.insert(
        "draftRows".into(),
        json!({ "metadata": [{ "key": "duplicate", "value": "unfinished" }, { "key": "duplicate", "value": "same" }] }),
    );
    apply(&mut connection, ConnectionAction::SetDraft(newer.clone()));
    apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
    assert_eq!(connection.params_draft(), Some(&newer));
    assert!(!connection.params().params.contains_key("draftRows"));
}

// The setups that the opening of a workbook starts, ported from `app/loading/initial_memory_setup.test.tsx`

mod open_setup {
    use super::*;
    use dashql_core_runtime::connections::open_setup::{OpenSetup, OpenSetups};

    fn embedded(connection_id: &str) -> ConnectionState {
        let params = ConnectionParams::default_for(ConnectorType::Hyper);
        ConnectionState::from_params(connection_id, params, NOW)
    }

    fn with_protocol(connection_id: &str, protocol: &str, endpoint: &str) -> ConnectionState {
        let mut params = ConnectionParams::default_for(ConnectorType::Hyper);
        params.params.insert("protocol".into(), json!(protocol));
        params.params.insert("endpoint".into(), json!(endpoint));
        ConnectionState::from_params(connection_id, params, NOW)
    }

    fn online(mut connection: ConnectionState) -> ConnectionState {
        let params = connection.params().params.clone();
        apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() }));
        apply(&mut connection, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params }));
        // A remote Hyper is online once its health check succeeded
        if connection.health() != ConnectionHealth::Online {
            apply(&mut connection, ConnectionAction::HealthCheckStarted);
            apply(&mut connection, ConnectionAction::HealthCheckSucceeded);
        }
        assert_eq!(connection.health(), ConnectionHealth::Online);
        connection
    }

    #[test]
    fn sets_up_the_embedded_hyper_once() {
        let mut setups = OpenSetups::new();
        let memory = embedded("memory");
        assert_eq!(setups.consider(&memory, None), OpenSetup::Setup);
        // Reopened, disconnected or online: never again
        assert_eq!(setups.consider(&memory, None), OpenSetup::Skip);
        assert_eq!(setups.consider(&online(embedded("memory")), None), OpenSetup::Skip);
        // Another connection of another workbook is considered on its own
        assert_eq!(setups.consider(&embedded("second-memory"), None), OpenSetup::Setup);
    }

    #[test]
    fn consumes_a_draft_another_protocol_and_an_open_connection_without_a_setup() {
        let draft = {
            let mut connection = embedded("draft");
            apply(&mut connection, ConnectionAction::SetDraft(with_draft_rows(hyper_params("a"))));
            connection
        };
        let http = with_protocol("http", "V3_HTTP", "https://hyper");
        let open = online(embedded("open"));
        let trino = ConnectionState::from_params("trino", ConnectionParams::default_for(ConnectorType::Trino), NOW);
        for connection in [draft, http, open, trino] {
            let mut setups = OpenSetups::new();
            assert_eq!(setups.consider(&connection, None), OpenSetup::Skip, "{}", connection.connection_id());
            // Consumed: the committed embedded params of a later reset don't opt it back in
            let reset = embedded(connection.connection_id());
            assert_eq!(setups.consider(&reset, None), OpenSetup::Skip, "{}", connection.connection_id());
        }
    }

    #[test]
    fn sets_up_the_hyper_of_a_link_once_per_link_and_resets_an_earlier_one() {
        let mut setups = OpenSetups::new();
        let linked = with_protocol("link", "V3_HTTP_LINK", "http://127.0.0.1:7484");
        // Without the token of the link it waits, nothing is consumed
        assert_eq!(setups.consider(&linked, None), OpenSetup::Skip);
        assert_eq!(setups.consider(&linked, Some("t1")), OpenSetup::Setup);
        assert_eq!(setups.consider(&linked, Some("t1")), OpenSetup::Skip);
        // A new link of the same connection speaks to another Hyper, the connection is reset first
        let open = online(with_protocol("link", "V3_HTTP_LINK", "http://127.0.0.1:7484"));
        assert_eq!(setups.consider(&open, Some("t2")), OpenSetup::ResetAndSetup);
        let moved = with_protocol("link", "V3_HTTP_LINK", "http://127.0.0.1:7485");
        assert_eq!(setups.consider(&moved, Some("t2")), OpenSetup::Setup);
    }

    #[test]
    fn keeps_no_token_of_a_link() {
        let mut setups = OpenSetups::new();
        let linked = with_protocol("link", "V3_HTTP_LINK", "http://127.0.0.1:7484");
        assert_eq!(setups.consider(&linked, Some("secret-link-token")), OpenSetup::Setup);
        assert!(!format!("{setups:?}").contains("secret-link-token"));
        assert_eq!(setups.consider(&linked, Some("secret-link-token")), OpenSetup::Skip);
    }
}

// The signatures of the cached results of a connection

mod cache_signatures {
    use super::*;
    use dashql_core_runtime::executor::cache_key::connection_cache_signature;
    use dashql_core_runtime::http::Headers;
    use dashql_core_runtime::hyper::{HyperChannelContext, HyperHttpChannel};
    use dashql_core_runtime::trino::{SharedTrinoChannel, TrinoAccessToken, TrinoChannel};

    fn trino_oauth_with(principal: Option<&str>) -> ConnectionState {
        let params = object(json!({ "endpoint": "https://trino.example.com", "auth": { "authType": "AUTH_OAUTH" } }));
        let mut connection = connection(ConnectionParams::new(ConnectorType::Trino, params.clone()));
        let mut channel = TrinoChannel::from_params(&params);
        channel.access_token = Some(TrinoAccessToken {
            created_at: 0,
            access_token: "token".into(),
            token_type: "Bearer".into(),
            refresh_token: None,
            expires_at: None,
            scope: None,
            principal: principal.map(str::to_string),
        });
        apply(&mut connection, ConnectionAction::Trino(TrinoAction::ChannelReady(SharedTrinoChannel::new(channel))));
        connection
    }

    #[test]
    fn trino_with_oauth_keys_the_results_by_the_account_of_the_token() {
        let alice = connection_cache_signature(&trino_oauth_with(Some("alice"))).unwrap();
        let bob = connection_cache_signature(&trino_oauth_with(Some("bob"))).unwrap();
        assert_eq!(alice["auth"]["principal"], "alice");
        assert_ne!(alice, bob);
        // Without the account the results get no key that another login could reuse
        assert_eq!(connection_cache_signature(&trino_oauth_with(None)), None);
        let params = object(json!({ "endpoint": "https://trino.example.com", "auth": { "authType": "AUTH_OAUTH" } }));
        assert_eq!(connection_cache_signature(&connection(ConnectionParams::new(ConnectorType::Trino, params))), None);
        // Basic auth keys by its user, also without a channel
        let basic = object(json!({ "endpoint": "https://trino.example.com", "auth": { "authType": "AUTH_BASIC", "basic": { "username": "u" } } }));
        let signature = connection_cache_signature(&connection(ConnectionParams::new(ConnectorType::Trino, basic))).unwrap();
        assert_eq!(signature["auth"]["user"], "u");
    }

    #[test]
    fn salesforce_keys_the_results_by_the_account_of_the_user_info_never_by_a_hint() {
        let mut params = salesforce_params();
        params.insert("login".into(), json!("typed-hint@example.com"));
        let mut connection = salesforce();
        apply(&mut connection, ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: params.clone() }));
        // The user info failed, the login is the hint that the user typed
        assert_eq!(connection_cache_signature(&connection), None);
        apply(&mut connection, user_info(Some("user@example.com"), None));
        let signature = connection_cache_signature(&connection).unwrap();
        assert_eq!(signature["login"], "user@example.com");
        // A reset forgets the account
        apply(&mut connection, ConnectionAction::Reset);
        assert_eq!(connection_cache_signature(&connection), None);
    }

    fn link_with(token: Option<&str>) -> ConnectionState {
        let mut params = ConnectionParams::default_for(ConnectorType::Hyper);
        params.params.insert("protocol".into(), json!("V3_HTTP_LINK"));
        params.params.insert("endpoint".into(), json!("http://127.0.0.1:7484"));
        let mut connection = connection(params.clone());
        if let Some(token) = token {
            let channel = HyperHttpChannel::connect(&params.params, HyperChannelContext::default(), None).unwrap();
            let auth = Headers::from_pairs([("authorization", format!("Bearer {token}"))]);
            let ready = HyperAction::ChannelReady { channel: ConnectionChannel::HyperHttp { channel, auth }, params: params.params.clone() };
            apply(&mut connection, ConnectionAction::Hyper(ready));
        }
        connection
    }

    #[test]
    fn the_hyper_of_a_link_keys_the_results_by_the_link() {
        let first = connection_cache_signature(&link_with(Some("t1"))).unwrap();
        let second = connection_cache_signature(&link_with(Some("t2"))).unwrap();
        // Another Hyper on the same port has another link and serves none of the results of the first one
        assert_ne!(first, second);
        assert_eq!(first, connection_cache_signature(&link_with(Some("t1"))).unwrap());
        assert!(!first.to_string().contains("t1"), "the signature keeps no token: {first}");
        // Without the channel of the link nothing is cached under a reusable key
        assert_eq!(connection_cache_signature(&link_with(None)), None);
        // A Hyper over HTTP without a link keys by its params
        let mut params = ConnectionParams::default_for(ConnectorType::Hyper);
        params.params.insert("protocol".into(), json!("V3_HTTP"));
        params.params.insert("endpoint".into(), json!("http://127.0.0.1:7484"));
        assert!(connection_cache_signature(&connection(params)).is_some());
    }
}
