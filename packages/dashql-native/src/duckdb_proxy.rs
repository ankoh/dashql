use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use crate::duckdb::{Connection, Database, QueryResult};
use crate::status::Status;

struct DatabaseEntry {
    next_connection_id: usize,
    connections: HashMap<usize, Connection>,
    database: Database,
}

impl DatabaseEntry {
    fn new(database: Database) -> Self {
        Self {
            next_connection_id: 1,
            connections: HashMap::new(),
            database,
        }
    }
}

impl Drop for DatabaseEntry {
    fn drop(&mut self) {
        self.connections.clear();
    }
}

#[derive(Default)]
pub struct DuckDBProxy {
    next_database_id: AtomicUsize,
    databases: Mutex<HashMap<usize, DatabaseEntry>>,
}

impl DuckDBProxy {
    pub fn create_database(&self) -> Result<usize, Status> {
        let database = Database::create().map_err(|message| Status::DuckDBOperationFailed {
            operation: "create database",
            message,
        })?;
        let database_id = self.next_database_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut databases = self.databases.lock().unwrap();
        databases.insert(database_id, DatabaseEntry::new(database));
        Ok(database_id)
    }

    pub fn destroy_database(&self, database_id: usize) -> Result<(), Status> {
        let mut databases = self.databases.lock().unwrap();
        if databases.remove(&database_id).is_none() {
            return Err(Status::DuckDBDatabaseIdIsUnknown { database_id });
        }
        Ok(())
    }

    pub fn open_database(&self, database_id: usize, args_json: &str) -> Result<(), Status> {
        let mut databases = self.databases.lock().unwrap();
        let database = databases
            .get_mut(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        database
            .database
            .open(args_json)
            .map_err(|message| Status::DuckDBOperationFailed {
                operation: "open database",
                message,
            })
    }

    pub fn reset_database(&self, database_id: usize) -> Result<(), Status> {
        let mut databases = self.databases.lock().unwrap();
        let database = databases
            .get_mut(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        database.connections.clear();
        database
            .database
            .reset()
            .map_err(|message| Status::DuckDBOperationFailed {
                operation: "reset database",
                message,
            })
    }

    pub fn get_version(&self, database_id: usize) -> Result<String, Status> {
        let databases = self.databases.lock().unwrap();
        let database = databases
            .get(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        database
            .database
            .get_version()
            .map_err(|message| Status::DuckDBOperationFailed {
                operation: "get database version",
                message,
            })
    }

    pub fn connect(&self, database_id: usize) -> Result<usize, Status> {
        let mut databases = self.databases.lock().unwrap();
        let database = databases
            .get_mut(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        let connection = database
            .database
            .connect()
            .map_err(|message| Status::DuckDBOperationFailed {
                operation: "connect to database",
                message,
            })?;
        let connection_id = database.next_connection_id;
        database.next_connection_id += 1;
        database.connections.insert(connection_id, connection);
        Ok(connection_id)
    }

    pub fn disconnect(&self, database_id: usize, connection_id: usize) -> Result<(), Status> {
        let mut databases = self.databases.lock().unwrap();
        let database = databases
            .get_mut(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        if database.connections.remove(&connection_id).is_none() {
            return Err(Status::DuckDBConnectionIdIsUnknown {
                database_id,
                connection_id,
            });
        }
        Ok(())
    }

    pub fn query(&self, database_id: usize, connection_id: usize, sql: &str) -> Result<QueryResult, Status> {
        let databases = self.databases.lock().unwrap();
        let database = databases
            .get(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        let connection = database
            .connections
            .get(&connection_id)
            .ok_or(Status::DuckDBConnectionIdIsUnknown {
                database_id,
                connection_id,
            })?;
        connection
            .query(sql)
            .map_err(|message| Status::DuckDBOperationFailed {
                operation: "run query",
                message,
            })
    }
}
