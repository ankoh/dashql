// Copyright (c) 2020 The DashQL Authors

use crate::error::Error;
use crate::proto::{Interval, QueryResult, QueryResultChunk, SQLType, VectorVariant};
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

    fn iterate_raw_vector<A: Copy, B: From<A>, F: Fn(usize, Option<&B>) -> ()>(
        &self,
        values: Option<&[A]>,
        nulls: Option<&[bool]>,
        f: &F,
    ) {
        match (values, nulls) {
            (None, _) => return,
            (Some(vs), None) => {
                for i in 0..vs.len() {
                    let v: B = vs[i].into();
                    f(i, Some(&v));
                }
            }
            (Some(vs), Some(ns)) => {
                for i in 0..vs.len() {
                    if ns[i] {
                        f(i, None);
                    } else {
                        let v: B = vs[i].into();
                        f(i, Some(&v));
                    };
                }
            }
        }
    }

    fn iterate_number_vector<
        'vector,
        A: flatbuffers::Follow<'vector>,
        B: From<A::Inner>,
        F: Fn(usize, Option<&B>) -> (),
    >(
        &'vector self,
        values: Option<flatbuffers::Vector<'vector, A>>,
        nulls: Option<&[bool]>,
        f: &F,
    ) {
        match (values, nulls) {
            (None, _) => return,
            (Some(vs), None) => {
                for i in 0..vs.len() {
                    let v: B = vs.get(i).into();
                    f(i, Some(&v));
                }
            }
            (Some(vs), Some(ns)) => {
                for i in 0..vs.len() {
                    if ns[i] {
                        f(i, None);
                    } else {
                        let v: B = vs.get(i).into();
                        f(i, Some(&v));
                    };
                }
            }
        }
    }

    fn iterate_string_vector<'a, V: Default, F: Fn(usize, Option<&V>) -> ()>(
        &self,
        values: Option<flatbuffers::Vector<'a, flatbuffers::ForwardsUOffset<&'a str>>>,
        nulls: Option<&[bool]>,
        f: &F,
    ) where
        str: AsRef<V>,
    {
        match (values, nulls) {
            (None, _) => return,
            (Some(vs), None) => {
                for i in 0..vs.len() {
                    f(i, Some(vs.get(i).as_ref()));
                }
            }
            (Some(vs), Some(ns)) => {
                for i in 0..vs.len() {
                    f(i, if ns[i] { None } else { Some(vs.get(i).as_ref()) });
                }
            }
        }
    }

    pub fn iterate_column<
        V: Default
            + Clone
            + From<i8>
            + From<u8>
            + From<i16>
            + From<u16>
            + From<i32>
            + From<u32>
            + From<i64>
            + From<u64>
            + From<i128>
            + From<f32>
            + From<f64>
            + From<Interval>,
        F: Fn(usize, Option<&V>) -> (),
    >(
        &self,
        cid: usize,
        f: &F,
    ) -> Result<(), Error>
    where
        str: AsRef<V>,
    {
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
            }
            VectorVariant::VectorI16 => {
                let v = column.variant_as_vector_i16().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorU16 => {
                let v = column.variant_as_vector_u16().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorI32 => {
                let v = column.variant_as_vector_i32().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorU32 => {
                let v = column.variant_as_vector_u32().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorI64 => {
                let v = column.variant_as_vector_i64().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorU64 => {
                let v = column.variant_as_vector_u64().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorF32 => {
                let v = column.variant_as_vector_f32().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorF64 => {
                let v = column.variant_as_vector_f64().unwrap();
                self.iterate_number_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::VectorI128 => (),
            VectorVariant::VectorInterval => (),
            VectorVariant::VectorString => {
                let v = column.variant_as_vector_string().unwrap();
                self.iterate_string_vector(v.values(), v.null_mask(), f);
            }
            VectorVariant::NONE => (),
        };
        Ok(())
    }
}
