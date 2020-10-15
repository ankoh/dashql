// Copyright (c) 2020 The DashQL Authors

use crate::error::Error;
use crate::proto::{QueryResult, QueryResultChunk, SQLType, VectorVariant};
use crate::webapi::{Buffer, Connection};

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
            None => 0,
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

    /// Get the column count
    pub fn get_column_count(&self) -> usize {
        self.column_types.len()
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

    /// Iterate over a vector
    fn iterate_raw_vector<V, F: Fn(usize, Option<V>) -> (), X>(
        &self,
        _values: Option<&[X]>,
        _nulls: Option<&[bool]>,
        _f: &F,
    ) {
    }

    /// Iterate over a vector
    fn iterate_number_vector<V, F: Fn(usize, Option<V>) -> (), X>(
        &self,
        _values: Option<flatbuffers::Vector<X>>,
        _nulls: Option<&[bool]>,
        _f: &F,
    ) {
    }

    /// Iterate over column
    pub fn iterate_column<V, F: Fn(usize, Option<V>) -> ()>(&self, cid: usize, f: &F) -> Result<(), Error> {
        let chunk = match self.current_chunk {
            Some(ref c) => c,
            None => return Ok(()),
        };
        let columns = match chunk.columns() {
            Some(c) => c,
            None => return Ok(()),
        };
        if cid >= columns.len() {
            return Err(Error::IndexOutOfBounds);
        }
        let column = columns.get(cid);
        match column.variant_type() {
            VectorVariant::VectorI8 => {
                let v = column.variant_as_vector_i8().unwrap();
                self.iterate_raw_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorU8 => {
                let v = column.variant_as_vector_u8().unwrap();
                self.iterate_raw_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorI16 => {
                let v = column.variant_as_vector_i16().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorU16 => {
                let v = column.variant_as_vector_u16().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorI32 => {
                let v = column.variant_as_vector_i32().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorU32 => {
                let v = column.variant_as_vector_u32().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorI64 => {
                let v = column.variant_as_vector_i64().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorU64 => {
                let v = column.variant_as_vector_u64().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorF32 => {
                let v = column.variant_as_vector_f32().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorF64 => {
                let v = column.variant_as_vector_f64().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            },
            VectorVariant::VectorI128 => (),
            VectorVariant::VectorInterval => (),
            VectorVariant::VectorString => (),
            VectorVariant::NONE => (),
        };
        Ok(())
    }
}
