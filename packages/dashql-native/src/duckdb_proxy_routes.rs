use lazy_static::lazy_static;
use regex_automata::meta::Regex;
use regex_automata::util::captures::Captures;

#[derive(Debug, PartialEq)]
pub enum DuckDBProxyRoute {
    Databases,
    Database { database_id: usize },
    DatabaseOpen { database_id: usize },
    DatabaseReset { database_id: usize },
    DatabaseVersion { database_id: usize },
    DatabaseConnections { database_id: usize },
    DatabaseConnection { database_id: usize, connection_id: usize },
    DatabaseConnectionQuery { database_id: usize, connection_id: usize },
    DatabaseConnectionPending { database_id: usize, connection_id: usize },
    DatabaseConnectionPendingRead { database_id: usize, connection_id: usize, stream_id: usize },
    DatabaseConnectionPendingResults { database_id: usize, connection_id: usize, stream_id: usize },
    DatabaseConnectionPreparedStatements { database_id: usize, connection_id: usize },
    DatabaseConnectionPreparedStatement { database_id: usize, connection_id: usize, statement_id: usize },
    DatabaseConnectionPreparedStatementRun { database_id: usize, connection_id: usize, statement_id: usize },
    DatabaseConnectionPreparedStatementSend { database_id: usize, connection_id: usize, statement_id: usize },
    DatabaseConnectionStream { database_id: usize, connection_id: usize, stream_id: usize },
    DatabaseConnectionUploads { database_id: usize, connection_id: usize },
    DatabaseConnectionUpload { database_id: usize, connection_id: usize, upload_id: usize },
    DatabaseConnectionUploadFinish { database_id: usize, connection_id: usize, upload_id: usize },
}

lazy_static! {
    static ref ROUTES: Regex = Regex::new_many(&[
        r"^/duckdb/databases$",
        r"^/duckdb/database/(\d+)$",
        r"^/duckdb/database/(\d+)/open$",
        r"^/duckdb/database/(\d+)/reset$",
        r"^/duckdb/database/(\d+)/version$",
        r"^/duckdb/database/(\d+)/connections$",
        r"^/duckdb/database/(\d+)/connection/(\d+)$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/query$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/pending$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/pending/(\d+)$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/pending/(\d+)/results$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/prepareds$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/prepared/(\d+)$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/prepared/(\d+)/run$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/prepared/(\d+)/send$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/stream/(\d+)$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/uploads$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/upload/(\d+)$",
        r"^/duckdb/database/(\d+)/connection/(\d+)/upload/(\d+)/finish$",
    ])
    .unwrap();
}

pub fn parse_duckdb_proxy_path(path: &str) -> Option<DuckDBProxyRoute> {
    let mut all = Captures::all(ROUTES.group_info().clone());
    ROUTES.captures(path, &mut all);
    match all.pattern().map(|p| p.as_usize()) {
        Some(0) => Some(DuckDBProxyRoute::Databases),
        Some(1) => Some(DuckDBProxyRoute::Database {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
        }),
        Some(2) => Some(DuckDBProxyRoute::DatabaseOpen {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
        }),
        Some(3) => Some(DuckDBProxyRoute::DatabaseReset {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
        }),
        Some(4) => Some(DuckDBProxyRoute::DatabaseVersion {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
        }),
        Some(5) => Some(DuckDBProxyRoute::DatabaseConnections {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
        }),
        Some(6) => Some(DuckDBProxyRoute::DatabaseConnection {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
        }),
        Some(7) => Some(DuckDBProxyRoute::DatabaseConnectionQuery {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
        }),
        Some(8) => Some(DuckDBProxyRoute::DatabaseConnectionPending {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
        }),
        Some(9) => Some(DuckDBProxyRoute::DatabaseConnectionPendingRead {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            stream_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(10) => Some(DuckDBProxyRoute::DatabaseConnectionPendingResults {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            stream_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(11) => Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatements {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
        }),
        Some(12) => Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatement {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            statement_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(13) => Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatementRun {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            statement_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(14) => Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatementSend {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            statement_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(15) => Some(DuckDBProxyRoute::DatabaseConnectionStream {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            stream_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(16) => Some(DuckDBProxyRoute::DatabaseConnectionUploads {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
        }),
        Some(17) => Some(DuckDBProxyRoute::DatabaseConnectionUpload {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            upload_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        Some(18) => Some(DuckDBProxyRoute::DatabaseConnectionUploadFinish {
            database_id: path[all.get_group(1).unwrap()].parse().unwrap_or_default(),
            connection_id: path[all.get_group(2).unwrap()].parse().unwrap_or_default(),
            upload_id: path[all.get_group(3).unwrap()].parse().unwrap_or_default(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod test {
    use anyhow::Result;

    use super::*;

    #[tokio::test]
    async fn test_valid_routes() -> Result<()> {
        assert_eq!(parse_duckdb_proxy_path("/duckdb/databases"), Some(DuckDBProxyRoute::Databases));
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/1"),
            Some(DuckDBProxyRoute::Database { database_id: 1 })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/1/open"),
            Some(DuckDBProxyRoute::DatabaseOpen { database_id: 1 })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/1/reset"),
            Some(DuckDBProxyRoute::DatabaseReset { database_id: 1 })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/1/version"),
            Some(DuckDBProxyRoute::DatabaseVersion { database_id: 1 })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/1/connections"),
            Some(DuckDBProxyRoute::DatabaseConnections { database_id: 1 })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/1/connection/2"),
            Some(DuckDBProxyRoute::DatabaseConnection {
                database_id: 1,
                connection_id: 2,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/query"),
            Some(DuckDBProxyRoute::DatabaseConnectionQuery {
                database_id: 123,
                connection_id: 456,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/pending"),
            Some(DuckDBProxyRoute::DatabaseConnectionPending {
                database_id: 123,
                connection_id: 456,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/pending/9"),
            Some(DuckDBProxyRoute::DatabaseConnectionPendingRead {
                database_id: 123,
                connection_id: 456,
                stream_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/pending/9/results"),
            Some(DuckDBProxyRoute::DatabaseConnectionPendingResults {
                database_id: 123,
                connection_id: 456,
                stream_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/prepareds"),
            Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatements {
                database_id: 123,
                connection_id: 456,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/prepared/9"),
            Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatement {
                database_id: 123,
                connection_id: 456,
                statement_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/prepared/9/run"),
            Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatementRun {
                database_id: 123,
                connection_id: 456,
                statement_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/prepared/9/send"),
            Some(DuckDBProxyRoute::DatabaseConnectionPreparedStatementSend {
                database_id: 123,
                connection_id: 456,
                statement_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/stream/9"),
            Some(DuckDBProxyRoute::DatabaseConnectionStream {
                database_id: 123,
                connection_id: 456,
                stream_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/uploads"),
            Some(DuckDBProxyRoute::DatabaseConnectionUploads {
                database_id: 123,
                connection_id: 456,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/upload/9"),
            Some(DuckDBProxyRoute::DatabaseConnectionUpload {
                database_id: 123,
                connection_id: 456,
                upload_id: 9,
            })
        );
        assert_eq!(
            parse_duckdb_proxy_path("/duckdb/database/123/connection/456/upload/9/finish"),
            Some(DuckDBProxyRoute::DatabaseConnectionUploadFinish {
                database_id: 123,
                connection_id: 456,
                upload_id: 9,
            })
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_invalid_routes() -> Result<()> {
        assert_eq!(parse_duckdb_proxy_path("/duckdb"), None);
        assert_eq!(parse_duckdb_proxy_path("/duckdb/database"), None);
        assert_eq!(parse_duckdb_proxy_path("/duckdb/database/foo"), None);
        assert_eq!(parse_duckdb_proxy_path("/duckdb/database/1/connection/foo"), None);
        assert_eq!(parse_duckdb_proxy_path("/duckdb/database/1/connection/2/query/3"), None);
        Ok(())
    }
}
