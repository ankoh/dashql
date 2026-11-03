//! Runs a local Trino server (single node, tpch catalog) for manual checks of the app, e.g. of the query
//! progress of long `tpch.sf10` queries.
//!
//! `bazel run //packages/trino-testing:trino_server [-- --port 8080]` starts the server and stops it when
//! Enter is pressed (or the input ends).

use std::io::BufRead;
use trino_testing::TrinoServer;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port = args
        .iter()
        .position(|arg| arg == "--port")
        .and_then(|i| args.get(i + 1))
        .map(|port| port.parse::<u16>().unwrap_or_else(|_| panic!("invalid port {port}")))
        .unwrap_or(8080);
    println!("Starting Trino on port {port}...");
    let server = TrinoServer::start_on_port(port).unwrap_or_else(|e| panic!("cannot start Trino: {e}"));
    println!("Trino serves at {} (catalog tpch, schemas tiny, sf1, sf10, ...)", server.endpoint);
    println!("Server log: {}", server.log_path.display());
    println!("Press Enter to stop.");
    let _ = std::io::stdin().lock().lines().next();
    drop(server);
}
