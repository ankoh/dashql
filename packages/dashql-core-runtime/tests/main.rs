//! The tests of the runtime, one module per file. The snapshot tests and the Hyper validation of the planner have
//! binaries of their own.

// The catalog loader as a service on a fake host: the queue, the relations of statements, Salesforce, client functions
mod catalog_loader_service_test;
mod catalog_loader_test;
// The client functions with the generated spec of the Data 360 extension
mod clfn_spec_test;
// The runtime of client functions against made-up specs and responses
mod clfn_test;
mod compute_service_test;
// The tasks of the computations on a fake compute host
mod compute_tasks_test;
mod compute_test;
// The setups of the connectors and the health checks on a fake host
mod connection_setup_test;
mod connections_test;
// The query executor on a fake host: Trino, Hyper over HTTP, client functions, a channel of the host and the cache
mod executor_test;
mod hyper_test;
// The planner with the script sessions of a workbook
mod planner_test;
mod query_test;
mod salesforce_test;
mod trino_test;
// The analyses of the scripts that the editors show on a clock of the test
mod visible_scripts_test;
// The runs of workbooks on a fake host
mod workbook_run_test;
mod workbook_test;
