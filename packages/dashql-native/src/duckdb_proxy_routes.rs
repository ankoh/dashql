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
