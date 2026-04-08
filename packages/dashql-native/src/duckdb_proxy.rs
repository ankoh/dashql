use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::duckdb::{Connection, Database, QueryStreamFetchResult};
use crate::status::Status;

#[derive(Default)]
pub enum DuckDBQueryBatchEvent {
    StreamFinished,
    FlushAfterTimeout,
    FlushAfterBytes,
    #[default]
    StreamFailed,
}

impl DuckDBQueryBatchEvent {
    pub fn to_str(&self) -> &'static str {
        match self {
            Self::StreamFinished => "StreamFinished",
            Self::FlushAfterTimeout => "FlushAfterTimeout",
            Self::FlushAfterBytes => "FlushAfterBytes",
            Self::StreamFailed => "StreamFailed",
        }
    }
}

#[derive(Default)]
pub struct DuckDBQueryBatch {
    pub event: DuckDBQueryBatchEvent,
    pub chunks: Vec<Vec<u8>>,
    pub total_bytes: usize,
    pub arrow_status_code: Option<u32>,
}

struct ConnectionEntry {
    connection: Connection,
    active_stream_id: Option<usize>,
    active_upload_id: Option<usize>,
}

struct DatabaseEntry {
    next_connection_id: usize,
    connections: HashMap<usize, Arc<Mutex<ConnectionEntry>>>,
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

struct QueryStreamEntry {
    database_id: usize,
    connection_id: usize,
    schema_chunk: Option<Vec<u8>>,
    schema_sent: bool,
}

struct ArrowUploadEntry {
    database_id: usize,
    connection_id: usize,
    options_json: String,
}

#[derive(Default)]
pub struct DuckDBProxy {
    next_database_id: AtomicUsize,
    next_stream_id: AtomicUsize,
    next_upload_id: AtomicUsize,
    databases: Mutex<HashMap<usize, DatabaseEntry>>,
    streams: Mutex<HashMap<usize, Arc<Mutex<QueryStreamEntry>>>>,
    uploads: Mutex<HashMap<usize, Arc<Mutex<ArrowUploadEntry>>>>,
}

impl DuckDBProxy {
    fn get_connection_entry(
        &self,
        database_id: usize,
        connection_id: usize,
    ) -> Result<Arc<Mutex<ConnectionEntry>>, Status> {
        let databases = self.databases.lock().unwrap();
        let database = databases
            .get(&database_id)
            .ok_or(Status::DuckDBDatabaseIdIsUnknown { database_id })?;
        database
            .connections
            .get(&connection_id)
            .cloned()
            .ok_or(Status::DuckDBConnectionIdIsUnknown {
                database_id,
                connection_id,
            })
    }

    fn clear_stream_binding(&self, database_id: usize, connection_id: usize, stream_id: usize) {
        if let Ok(connection) = self.get_connection_entry(database_id, connection_id) {
            if let Ok(mut connection) = connection.lock() {
                if connection.active_stream_id == Some(stream_id) {
                    connection.active_stream_id = None;
                }
            }
        }
    }

    fn clear_upload_binding(&self, database_id: usize, connection_id: usize, upload_id: usize) {
        if let Ok(connection) = self.get_connection_entry(database_id, connection_id) {
            if let Ok(mut connection) = connection.lock() {
                if connection.active_upload_id == Some(upload_id) {
                    connection.active_upload_id = None;
                }
            }
        }
    }

    fn destroy_stream_entry(&self, stream_id: usize) {
        let removed = self.streams.lock().unwrap().remove(&stream_id);
        if let Some(stream) = removed {
            let stream = stream.lock().unwrap();
            self.clear_stream_binding(stream.database_id, stream.connection_id, stream_id);
        }
    }

    fn destroy_upload_entry(&self, upload_id: usize) {
        let removed = self.uploads.lock().unwrap().remove(&upload_id);
        if let Some(upload) = removed {
            let upload = upload.lock().unwrap();
            self.clear_upload_binding(upload.database_id, upload.connection_id, upload_id);
        }
    }

    fn destroy_database_sessions(&self, database_id: usize) {
        let stream_ids = {
            let streams = self.streams.lock().unwrap();
            streams
                .iter()
                .filter_map(|(stream_id, entry)| {
                    let entry = entry.lock().unwrap();
                    (entry.database_id == database_id).then_some(*stream_id)
                })
                .collect::<Vec<_>>()
        };
        for stream_id in stream_ids {
            self.destroy_stream_entry(stream_id);
        }

        let upload_ids = {
            let uploads = self.uploads.lock().unwrap();
            uploads
                .iter()
                .filter_map(|(upload_id, entry)| {
                    let entry = entry.lock().unwrap();
                    (entry.database_id == database_id).then_some(*upload_id)
                })
                .collect::<Vec<_>>()
        };
        for upload_id in upload_ids {
            self.destroy_upload_entry(upload_id);
        }
    }

    fn destroy_connection_sessions(&self, database_id: usize, connection_id: usize) {
        let stream_ids = {
            let streams = self.streams.lock().unwrap();
            streams
                .iter()
                .filter_map(|(stream_id, entry)| {
                    let entry = entry.lock().unwrap();
                    (entry.database_id == database_id && entry.connection_id == connection_id).then_some(*stream_id)
                })
                .collect::<Vec<_>>()
        };
        for stream_id in stream_ids {
            self.destroy_stream_entry(stream_id);
        }

        let upload_ids = {
            let uploads = self.uploads.lock().unwrap();
            uploads
                .iter()
                .filter_map(|(upload_id, entry)| {
                    let entry = entry.lock().unwrap();
                    (entry.database_id == database_id && entry.connection_id == connection_id).then_some(*upload_id)
                })
                .collect::<Vec<_>>()
        };
        for upload_id in upload_ids {
            self.destroy_upload_entry(upload_id);
        }
    }

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
        self.destroy_database_sessions(database_id);
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
        self.destroy_database_sessions(database_id);
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
        database.connections.insert(
            connection_id,
            Arc::new(Mutex::new(ConnectionEntry {
                connection,
                active_stream_id: None,
                active_upload_id: None,
            })),
        );
        Ok(connection_id)
    }

    pub fn disconnect(&self, database_id: usize, connection_id: usize) -> Result<(), Status> {
        self.destroy_connection_sessions(database_id, connection_id);
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

    pub fn start_query_stream(&self, database_id: usize, connection_id: usize, sql: &str) -> Result<usize, Status> {
        let connection = self.get_connection_entry(database_id, connection_id)?;
        let mut connection = connection.lock().unwrap();
        if connection.active_stream_id.is_some() || connection.active_upload_id.is_some() {
            return Err(Status::DuckDBConnectionBusy {
                database_id,
                connection_id,
                activity: "query stream",
            });
        }
        let schema_chunk = connection
            .connection
            .start_pending_query(sql, true)
            .map_err(|message| Status::DuckDBOperationFailed {
                operation: "start query stream",
                message,
            })?;
        let stream_id = self.next_stream_id.fetch_add(1, Ordering::Relaxed) + 1;
        connection.active_stream_id = Some(stream_id);
        drop(connection);

        self.streams.lock().unwrap().insert(
            stream_id,
            Arc::new(Mutex::new(QueryStreamEntry {
                database_id,
                connection_id,
                schema_chunk,
                schema_sent: false,
            })),
        );
        Ok(stream_id)
    }

    pub fn read_query_stream(
        &self,
        database_id: usize,
        connection_id: usize,
        stream_id: usize,
        read_timeout: Duration,
        batch_timeout: Duration,
        batch_bytes: usize,
    ) -> Result<DuckDBQueryBatch, Status> {
        let stream = self
            .streams
            .lock()
            .unwrap()
            .get(&stream_id)
            .cloned()
            .ok_or(Status::DuckDBStreamIdIsUnknown {
                database_id,
                connection_id,
                stream_id,
            })?;
        {
            let stream = stream.lock().unwrap();
            if stream.database_id != database_id || stream.connection_id != connection_id {
                return Err(Status::DuckDBStreamIdIsUnknown {
                    database_id,
                    connection_id,
                    stream_id,
                });
            }
        }
        let connection = self.get_connection_entry(database_id, connection_id)?;
        let started_at = Instant::now();
        let mut batch = DuckDBQueryBatch::default();

        loop {
            let elapsed = started_at.elapsed();
            let timed_out = if batch.chunks.is_empty() {
                elapsed >= read_timeout
            } else {
                elapsed >= batch_timeout
            };
            if timed_out {
                if batch.chunks.is_empty() {
                    return Err(Status::DuckDBStreamReadTimedOut {
                        database_id,
                        connection_id,
                        stream_id,
                    });
                }
                batch.event = DuckDBQueryBatchEvent::FlushAfterTimeout;
                return Ok(batch);
            }

            let mut emitted_schema = false;
            let mut waiting_for_schema = false;
            {
                let mut stream = stream.lock().unwrap();
                if !stream.schema_sent {
                    let next_schema = if let Some(bytes) = stream.schema_chunk.take() {
                        Some(bytes)
                    } else {
                        let connection = connection.lock().unwrap();
                        connection
                            .connection
                            .poll_pending_query()
                            .map_err(|message| Status::DuckDBOperationFailed {
                                operation: "poll query stream",
                                message,
                            })?
                    };
                    if let Some(schema) = next_schema {
                        batch.total_bytes += schema.len();
                        batch.chunks.push(schema);
                        stream.schema_sent = true;
                        emitted_schema = true;
                        if batch.total_bytes > batch_bytes {
                            batch.event = DuckDBQueryBatchEvent::FlushAfterBytes;
                            return Ok(batch);
                        }
                    } else {
                        waiting_for_schema = true;
                    }
                }
            }
            if emitted_schema {
                continue;
            }
            if waiting_for_schema {
                continue;
            }

            let fetch_result = {
                let connection = connection.lock().unwrap();
                connection
                    .connection
                    .fetch_query_results()
                    .map_err(|message| Status::DuckDBOperationFailed {
                        operation: "read query stream",
                        message,
                    })?
            };
            match fetch_result {
                QueryStreamFetchResult::Chunk(result) => {
                    batch.total_bytes += result.bytes.len();
                    batch.arrow_status_code = Some(result.arrow_status_code);
                    batch.chunks.push(result.bytes);
                    if batch.total_bytes > batch_bytes {
                        batch.event = DuckDBQueryBatchEvent::FlushAfterBytes;
                        return Ok(batch);
                    }
                }
                QueryStreamFetchResult::Retry => {
                    if !batch.chunks.is_empty() {
                        batch.event = DuckDBQueryBatchEvent::FlushAfterTimeout;
                        return Ok(batch);
                    }
                }
                QueryStreamFetchResult::EndOfStream => {
                    self.destroy_stream_entry(stream_id);
                    batch.event = DuckDBQueryBatchEvent::StreamFinished;
                    return Ok(batch);
                }
            }
        }
    }

    pub fn destroy_query_stream(&self, database_id: usize, connection_id: usize, stream_id: usize) -> Result<(), Status> {
        let stream = self
            .streams
            .lock()
            .unwrap()
            .get(&stream_id)
            .cloned()
            .ok_or(Status::DuckDBStreamIdIsUnknown {
                database_id,
                connection_id,
                stream_id,
            })?;
        {
            let stream = stream.lock().unwrap();
            if stream.database_id != database_id || stream.connection_id != connection_id {
                return Err(Status::DuckDBStreamIdIsUnknown {
                    database_id,
                    connection_id,
                    stream_id,
                });
            }
        }
        let connection = self.get_connection_entry(database_id, connection_id)?;
        {
            let connection = connection.lock().unwrap();
            connection
                .connection
                .cancel_pending_query()
                .map_err(|message| Status::DuckDBOperationFailed {
                    operation: "cancel query stream",
                    message,
                })?;
        }
        self.destroy_stream_entry(stream_id);
        Ok(())
    }

    pub fn create_arrow_ipc_upload(
        &self,
        database_id: usize,
        connection_id: usize,
        options_json: &str,
    ) -> Result<usize, Status> {
        let connection = self.get_connection_entry(database_id, connection_id)?;
        let mut connection = connection.lock().unwrap();
        if connection.active_stream_id.is_some() || connection.active_upload_id.is_some() {
            return Err(Status::DuckDBConnectionBusy {
                database_id,
                connection_id,
                activity: "arrow upload",
            });
        }
        let upload_id = self.next_upload_id.fetch_add(1, Ordering::Relaxed) + 1;
        connection.active_upload_id = Some(upload_id);
        drop(connection);
        self.uploads.lock().unwrap().insert(
            upload_id,
            Arc::new(Mutex::new(ArrowUploadEntry {
                database_id,
                connection_id,
                options_json: options_json.to_string(),
            })),
        );
        Ok(upload_id)
    }

    pub fn push_arrow_ipc_upload_chunk(
        &self,
        database_id: usize,
        connection_id: usize,
        upload_id: usize,
        buffer: &[u8],
        finish: bool,
    ) -> Result<(), Status> {
        let upload = self
            .uploads
            .lock()
            .unwrap()
            .get(&upload_id)
            .cloned()
            .ok_or(Status::DuckDBUploadIdIsUnknown {
                database_id,
                connection_id,
                upload_id,
            })?;
        let options_json = {
            let upload = upload.lock().unwrap();
            if upload.database_id != database_id || upload.connection_id != connection_id {
                return Err(Status::DuckDBUploadIdIsUnknown {
                    database_id,
                    connection_id,
                    upload_id,
                });
            }
            upload.options_json.clone()
        };
        let connection = self.get_connection_entry(database_id, connection_id)?;
        {
            let connection = connection.lock().unwrap();
            connection
                .connection
                .insert_arrow_from_ipc_stream(buffer, &options_json)
                .map_err(|message| Status::DuckDBOperationFailed {
                    operation: "insert arrow ipc stream",
                    message,
                })?;
        }
        if finish {
            self.destroy_upload_entry(upload_id);
        }
        Ok(())
    }
}
