//! Tests of the planner with the script sessions of a workbook.

use dashql_buffers::editor::{EditorEventT, EditorOffsetUnit, EditorTextChangeT, EditorUpdateStatus, EditorUpdateT};
use dashql_buffers::execution::ExecutionGraphT;
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::catalog::{Catalog, CatalogLayer};
use dashql_core::script::Script;
use dashql_core_runtime::planner::{plan_session, ConnectionKind, PlanScope, PlannerConnection, PlannerScript, SessionPlanRequest};
use dashql_core_script::script_session::ScriptSession;

/// Plan scripts of one catalog as the session of one connection
fn plan_scripts(catalog: &Catalog, scripts: &[&Script]) -> ExecutionGraphT {
    let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Remote, catalog, dialect: FormattingDialect::HYPER, default_database: "", default_schema: "" }];
    let scripts: Vec<_> = scripts.iter().map(|&script| PlannerScript { script, name: "", connection: 0, materialization_file: None, current_by_own_publish: false }).collect();
    plan_session(&SessionPlanRequest { connections: &connections, scripts: &scripts, scope: PlanScope::Session, materialized: &[], mount_prefix: "", attachments: &[], attachment_prefix: "" })
}

/// Replace the text of a session and analyze in one event
fn analyze(session: &mut ScriptSession, catalog: &Catalog, text: &str) -> EditorUpdateT {
    let mut change = EditorTextChangeT::default();
    change.from = 0;
    change.to = session.text().len() as u64;
    change.insert = Some(text.to_string());
    let mut event = EditorEventT::default();
    event.expected_text_version = session.text_version();
    event.changes = Some(vec![change]);
    event.analyze = true;
    session.apply(catalog, &event)
}

#[test]
fn published_sessions_refresh_at_final_catalog_revision_before_planning() {
    let mut catalog = Catalog::new();
    let mut schema = ScriptSession::new(&catalog, EditorOffsetUnit::UTF8_BYTES).unwrap();
    let mut query = ScriptSession::new(&catalog, EditorOffsetUnit::UTF8_BYTES).unwrap();
    assert!(analyze(&mut schema, &catalog, "create table items (id int)").analysis_available);
    schema.load_into_catalog(&mut catalog, CatalogLayer::SESSION).unwrap();
    assert!(analyze(&mut query, &catalog, "select id from items").analysis_available);
    query.load_into_catalog(&mut catalog, CatalogLayer::SESSION).unwrap();

    let final_revision = catalog.version();
    assert_ne!(query.script().analyzed.as_ref().unwrap().entry.catalog_version, final_revision);
    for session in [&mut schema, &mut query] {
        let update = session.analyze(&catalog);
        assert_eq!(update.status, EditorUpdateStatus::OK);
        assert!(update.analysis_updated);
        assert!(update.analysis_available);
        assert_eq!(update.catalog_revision, final_revision as u64);
        assert_eq!(session.script().analyzed.as_ref().unwrap().entry.catalog_version, final_revision);
        assert_eq!(catalog.version(), final_revision);
    }
    for session in [&mut schema, &mut query] {
        let update = session.analyze(&catalog);
        assert!(!update.analysis_updated);
        assert!(update.analysis_available);
    }

    let graph = plan_scripts(&catalog, &[schema.script(), query.script()]);
    assert!(graph.valid);
    assert!(graph.diagnostics.as_ref().is_none_or(|d| d.is_empty()));
    assert!(graph.unresolved_references.as_ref().is_none_or(|r| r.is_empty()));
    assert_eq!(graph.nodes.as_ref().map_or(0, |n| n.len()), 2);
    let scripts = graph.scripts.as_ref().unwrap();
    assert_eq!(scripts.len(), 2);
    for script in scripts {
        assert_eq!(script.analyzed_catalog_revision, final_revision as u64);
    }
    assert_eq!(catalog.version(), final_revision);

    schema.drop_from_catalog(&mut catalog);
    query.drop_from_catalog(&mut catalog);
}
