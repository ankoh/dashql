//! Standalone HTTP v3 → gRPC proxy for the Salesforce Hyper Database.
//!
//! Accepts requests on the Salesforce Query Service V3 HTTP surface
//! (`/v3/query...`) and forwards them to a Hyper gRPC endpoint selected
//! per-request via the `X-Grpc-Endpoint` header.

mod arrow_stream;
mod config;
mod cors;
mod errors;
mod grpc_client;
mod http_api;
mod query_registry;
mod query_state;
mod status;

#[cfg(test)]
mod test;

pub mod proto {
    pub mod hyper {
        include!(concat!(env!("OUT_DIR"), "/salesforce.hyperdb.grpc.v1.rs"));
    }
}

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::Parser;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use crate::config::{Args, Config};

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .parse_default_env()
        .init();

    let args = Args::parse();
    let listen: SocketAddr = args
        .listen
        .parse()
        .with_context(|| format!("parse --listen: {}", args.listen))?;

    let cfg = Arc::new(Config::from_args(args)?);
    cfg.registry.clone().spawn_sweeper(cfg.expiration_ttl);

    let listener = TcpListener::bind(listen)
        .await
        .with_context(|| format!("bind {}", listen))?;

    log::info!(
        "hyper-http-proxy listening on http://{}, allow-forward-to=[{}]",
        listen,
        cfg.allow_forward_to
            .iter()
            .map(|p| p.display())
            .collect::<Vec<_>>()
            .join(", ")
    );

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                log::error!("accept: {}", e);
                continue;
            }
        };
        let cfg = cfg.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |req| http_api::handle(req, cfg.clone()));
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service)
                .await
            {
                log::debug!("conn {} ended: {}", peer, e);
            }
        });
    }
}
