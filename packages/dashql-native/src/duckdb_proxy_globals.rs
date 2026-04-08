use std::io::Write;

use byteorder::LittleEndian;
use byteorder::WriteBytesExt;
use lazy_static::lazy_static;
use tauri::http::Request;
use tauri::http::Response;

use crate::duckdb_proxy::DuckDBProxy;
use crate::proxy_headers::HEADER_NAME_BATCH_BYTES;
use crate::proxy_headers::HEADER_NAME_BATCH_CHUNKS;
use crate::proxy_headers::HEADER_NAME_BATCH_EVENT;
use crate::proxy_headers::HEADER_NAME_ARROW_STATUS;
use crate::proxy_headers::HEADER_NAME_CONNECTION_ID;
use crate::proxy_headers::HEADER_NAME_DATABASE_ID;
use crate::proxy_headers::HEADER_NAME_READ_TIMEOUT;
use crate::proxy_headers::HEADER_NAME_BATCH_TIMEOUT;
use crate::proxy_headers::HEADER_NAME_STREAM_ID;
use crate::proxy_headers::HEADER_NAME_UPLOAD_ID;
use crate::status::Status;

lazy_static! {
    static ref DUCKDB_PROXY: DuckDBProxy = DuckDBProxy::default();
}

fn read_utf8_body(body: &[u8], operation: &'static str) -> Result<String, Status> {
    String::from_utf8(body.to_vec()).map_err(|e| Status::DuckDBBodyHasInvalidEncoding {
        operation,
        message: e.to_string(),
    })
}

fn require_usize_header(headers: &tauri::http::HeaderMap, header_name: &'static str) -> Result<usize, Status> {
    if let Some(header) = headers.get(header_name) {
        let header = header
            .to_str()
            .map_err(|e| Status::HeaderHasInvalidEncoding {
                header: header_name,
                message: e.to_string(),
            })?
            .to_string();
        header.parse::<usize>().map_err(|e| Status::HeaderIsNotAnUsize {
            header: header_name,
            message: e.to_string(),
        })
    } else {
        Err(Status::HeaderRequiredButMissing { header: header_name })
    }
}

pub async fn create_database(_req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.create_database() {
        Ok(database_id) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn delete_database(database_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.destroy_database(database_id) {
        Ok(()) => Response::builder().status(200).body(Vec::new()).unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn open_database(database_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    let args_json = match read_utf8_body(&body, "open database") {
        Ok(body) => body,
        Err(e) => return Response::from(&e),
    };
    match DUCKDB_PROXY.open_database(database_id, &args_json) {
        Ok(()) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn reset_database(database_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.reset_database(database_id) {
        Ok(()) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn get_database_version(database_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.get_version(database_id) {
        Ok(version) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .body(version.into_bytes())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn create_connection(database_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.connect(database_id) {
        Ok(connection_id) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn delete_connection(database_id: usize, connection_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.disconnect(database_id, connection_id) {
        Ok(()) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn start_query_stream(database_id: usize, connection_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    let sql = match read_utf8_body(&body, "start query stream") {
        Ok(body) => body,
        Err(e) => return Response::from(&e),
    };
    match DUCKDB_PROXY.start_query_stream(database_id, connection_id, &sql) {
        Ok(stream_id) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .header(HEADER_NAME_STREAM_ID, stream_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn read_query_stream(database_id: usize, connection_id: usize, stream_id: usize, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let read_timeout = match require_usize_header(req.headers(), HEADER_NAME_READ_TIMEOUT) {
        Ok(value) => value,
        Err(e) => return Response::from(&e),
    };
    let batch_timeout = match require_usize_header(req.headers(), HEADER_NAME_BATCH_TIMEOUT) {
        Ok(value) => value,
        Err(e) => return Response::from(&e),
    };
    let batch_bytes = match require_usize_header(req.headers(), HEADER_NAME_BATCH_BYTES) {
        Ok(value) => value,
        Err(e) => return Response::from(&e),
    };
    match DUCKDB_PROXY.read_query_stream(
        database_id,
        connection_id,
        stream_id,
        std::time::Duration::from_millis(read_timeout as u64),
        std::time::Duration::from_millis(batch_timeout as u64),
        batch_bytes,
    ) {
        Ok(batch) => {
            let mut buffer = Vec::with_capacity(batch.total_bytes + 4 * batch.chunks.len());
            for chunk in &batch.chunks {
                buffer.write_u32::<LittleEndian>(chunk.len() as u32).unwrap();
                buffer.write_all(chunk).unwrap();
            }
            let mut response = Response::builder()
                .status(200)
                .header(HEADER_NAME_DATABASE_ID, database_id)
                .header(HEADER_NAME_CONNECTION_ID, connection_id)
                .header(HEADER_NAME_STREAM_ID, stream_id)
                .header(HEADER_NAME_BATCH_EVENT, batch.event.to_str())
                .header(HEADER_NAME_BATCH_CHUNKS, batch.chunks.len())
                .header(HEADER_NAME_BATCH_BYTES, batch.total_bytes);
            if let Some(arrow_status_code) = batch.arrow_status_code {
                response = response.header(HEADER_NAME_ARROW_STATUS, arrow_status_code);
            }
            response.body(buffer).unwrap()
        }
        Err(e) => Response::from(&e),
    }
}

pub async fn delete_query_stream(database_id: usize, connection_id: usize, stream_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DUCKDB_PROXY.destroy_query_stream(database_id, connection_id, stream_id) {
        Ok(()) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .header(HEADER_NAME_STREAM_ID, stream_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn create_arrow_ipc_upload(database_id: usize, connection_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    let options_json = match read_utf8_body(&body, "create arrow ipc upload") {
        Ok(body) => body,
        Err(e) => return Response::from(&e),
    };
    match DUCKDB_PROXY.create_arrow_ipc_upload(database_id, connection_id, &options_json) {
        Ok(upload_id) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .header(HEADER_NAME_UPLOAD_ID, upload_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

pub async fn push_arrow_ipc_upload_chunk(
    database_id: usize,
    connection_id: usize,
    upload_id: usize,
    finish: bool,
    mut req: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    match DUCKDB_PROXY.push_arrow_ipc_upload_chunk(database_id, connection_id, upload_id, &body, finish) {
        Ok(()) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .header(HEADER_NAME_UPLOAD_ID, upload_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}
