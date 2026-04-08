use tauri::http::header::CONTENT_TYPE;
use tauri::http::Request;

use crate::ipc_router::route_ipc_request;
use crate::proxy_headers::HEADER_NAME_ARROW_STATUS;
use crate::proxy_headers::HEADER_NAME_CONNECTION_ID;
use crate::proxy_headers::HEADER_NAME_DATABASE_ID;

#[tokio::test]
async fn test_duckdb_database_connection_and_query_lifecycle() -> anyhow::Result<()> {
    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri("dashql-native://localhost/duckdb/databases")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);
    let database_id: usize = response
        .headers()
        .get(HEADER_NAME_DATABASE_ID)
        .unwrap()
        .to_str()
        .unwrap()
        .parse()
        .unwrap();

    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("dashql-native://localhost/duckdb/database/{}/open", database_id))
        .header(CONTENT_TYPE, mime::APPLICATION_JSON.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);

    let request: Request<Vec<u8>> = Request::builder()
        .method("GET")
        .uri(format!("dashql-native://localhost/duckdb/database/{}/version", database_id))
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);
    let version = String::from_utf8(response.body().clone()).unwrap();
    assert!(!version.trim().is_empty());

    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("dashql-native://localhost/duckdb/database/{}/connections", database_id))
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);
    let connection_id: usize = response
        .headers()
        .get(HEADER_NAME_CONNECTION_ID)
        .unwrap()
        .to_str()
        .unwrap()
        .parse()
        .unwrap();

    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!(
            "dashql-native://localhost/duckdb/database/{}/connection/{}/query",
            database_id, connection_id
        ))
        .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
        .body(b"SELECT 42 AS answer".to_vec())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key(HEADER_NAME_ARROW_STATUS));
    assert!(!response.body().is_empty());

    let request: Request<Vec<u8>> = Request::builder()
        .method("DELETE")
        .uri(format!(
            "dashql-native://localhost/duckdb/database/{}/connection/{}",
            database_id, connection_id
        ))
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);

    let request: Request<Vec<u8>> = Request::builder()
        .method("DELETE")
        .uri(format!("dashql-native://localhost/duckdb/database/{}", database_id))
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);

    Ok(())
}

#[tokio::test]
async fn test_duckdb_unknown_database_returns_not_found() -> anyhow::Result<()> {
    let request: Request<Vec<u8>> = Request::builder()
        .method("GET")
        .uri("dashql-native://localhost/duckdb/database/999999/version")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 404);
    Ok(())
}

#[tokio::test]
async fn test_duckdb_unknown_connection_returns_not_found() -> anyhow::Result<()> {
    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri("dashql-native://localhost/duckdb/databases")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    let database_id: usize = response
        .headers()
        .get(HEADER_NAME_DATABASE_ID)
        .unwrap()
        .to_str()
        .unwrap()
        .parse()
        .unwrap();

    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("dashql-native://localhost/duckdb/database/{}/open", database_id))
        .header(CONTENT_TYPE, mime::APPLICATION_JSON.essence_str())
        .body(Vec::new())
        .unwrap();
    let _response = route_ipc_request(request).await;

    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!(
            "dashql-native://localhost/duckdb/database/{}/connection/999999/query",
            database_id
        ))
        .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
        .body(b"SELECT 1".to_vec())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 404);

    let request: Request<Vec<u8>> = Request::builder()
        .method("DELETE")
        .uri(format!("dashql-native://localhost/duckdb/database/{}", database_id))
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    let _response = route_ipc_request(request).await;

    Ok(())
}
