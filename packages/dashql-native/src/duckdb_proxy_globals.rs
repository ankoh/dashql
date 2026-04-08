use lazy_static::lazy_static;
use tauri::http::Request;
use tauri::http::Response;

use crate::duckdb_proxy::DuckDBProxy;
use crate::proxy_headers::HEADER_NAME_ARROW_STATUS;
use crate::proxy_headers::HEADER_NAME_CONNECTION_ID;
use crate::proxy_headers::HEADER_NAME_DATABASE_ID;
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

pub async fn run_query(database_id: usize, connection_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    let sql = match read_utf8_body(&body, "run query") {
        Ok(body) => body,
        Err(e) => return Response::from(&e),
    };
    match DUCKDB_PROXY.query(database_id, connection_id, &sql) {
        Ok(result) => Response::builder()
            .status(200)
            .header(HEADER_NAME_DATABASE_ID, database_id)
            .header(HEADER_NAME_CONNECTION_ID, connection_id)
            .header(HEADER_NAME_ARROW_STATUS, result.arrow_status_code)
            .body(result.bytes)
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}
