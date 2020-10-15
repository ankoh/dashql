// Copyright (c) 2020 The DashQL Authors

use crate::error::Error;
use crate::proto::{QueryResult, QueryResultChunk, SQLType};
use crate::webapi::{Connection, Buffer};

pub struct QueryResultChunkStream<'chunks, 'result: 'chunks, 'conn: 'result> {
    connection: &'conn Connection,
    result: &'result QueryResult<'result>,
    column_types: Vec<SQLType>,
    embedded_chunk_count: usize,
    current_chunk_id: usize,
    current_chunk_buffer: Option<Buffer<'conn, QueryResultChunk<'chunks>>>,
    current_chunk: Option<QueryResultChunk<'chunks>>,
}

impl<'chunks, 'result: 'chunks, 'conn: 'result> QueryResultChunkStream<'chunks, 'result, 'conn> {
    /// Create chunk
    pub fn from_result(conn: &'conn Connection, res: &'result QueryResult<'result>) -> Self {
        let embedded_chunk_count = match res.data_chunks() {
            Some(c) => c.len(),
            None => 0
        };
        let mut column_types: Vec<SQLType> = Vec::new();
        if let Some(types) = res.column_types() {
            column_types.reserve(types.len());
            for i in 0..types.len() {
                column_types.push(types.get(i).unwrap().clone());
            }
        }
        Self {
            connection: conn,
            result: res,
            embedded_chunk_count,
            column_types,
            current_chunk_id: !0,
            current_chunk_buffer: None,
            current_chunk: None,
        }
    }

    /// Get next chunk
    pub fn next(&mut self) -> Result<bool, Error> {
        self.current_chunk_id += 1;
        if self.current_chunk_id < self.embedded_chunk_count {
            self.current_chunk = Some(self.result.data_chunks().unwrap().get(self.current_chunk_id));
        } else {
            let mut c = self.connection.fetch_query_results()?;
            self.current_chunk = Some(c.access());
            self.current_chunk_buffer = Some(c);
        }
        Ok(self.current_chunk.unwrap().row_count() > 0)
    }
}
