//! Results as Arrow IPC: what crosses between the executor and the host.
//!
//! A result never stays in the module. A connector that converts its pages to Arrow (Trino) writes every page as the
//! next part of one Arrow IPC stream and hands it to the host right away, the host builds the result from the parts. The metadata queries of the catalog loader cross the other way, as a whole stream.

use std::io::Cursor;
use std::sync::Arc;

use arrow_array::RecordBatch;
use arrow_ipc::reader::StreamReader;
use arrow_ipc::writer::StreamWriter;
use arrow_schema::{ArrowError, Schema, SchemaRef};

fn write_error(e: ArrowError) -> String {
    format!("failed to write the result: {e}")
}

/// One Arrow IPC stream written in parts: the schema with the first part, a batch per part, the end-of-stream marker
/// with the last part. The writer keeps only the bytes of the part that it writes.
pub struct IpcStreamWriter {
    writer: StreamWriter<Vec<u8>>,
}

impl IpcStreamWriter {
    /// A stream of a schema, the first part will hold it
    pub fn new(schema: &SchemaRef) -> Result<Self, String> {
        Ok(Self { writer: StreamWriter::try_new(Vec::new(), schema).map_err(write_error)? })
    }

    /// The bytes written since the last part
    fn take(&mut self) -> Vec<u8> {
        std::mem::take(self.writer.get_mut())
    }

    /// Write a batch, returns the next part
    pub fn write(&mut self, batch: &RecordBatch) -> Result<Vec<u8>, String> {
        self.writer.write(batch).map_err(write_error)?;
        Ok(self.take())
    }

    /// End the stream, returns the last part
    pub fn finish(&mut self) -> Result<Vec<u8>, String> {
        self.writer.finish().map_err(write_error)?;
        Ok(self.take())
    }
}

/// Write a schema and its batches as one Arrow IPC stream
pub fn write_stream(schema: &SchemaRef, batches: &[RecordBatch]) -> Result<Vec<u8>, String> {
    let mut writer = IpcStreamWriter::new(schema)?;
    let mut bytes = writer.take();
    for batch in batches {
        bytes.extend(writer.write(batch)?);
    }
    bytes.extend(writer.finish()?);
    Ok(bytes)
}

/// Read an Arrow IPC stream: its schema, an empty one without, and its batches
pub fn read_stream(bytes: &[u8]) -> Result<(SchemaRef, Vec<RecordBatch>), String> {
    let error = |e: ArrowError| format!("failed to read a result: {e}");
    if bytes.is_empty() {
        return Ok((Arc::new(Schema::empty()), Vec::new()));
    }
    let reader = StreamReader::try_new(Cursor::new(bytes), None).map_err(error)?;
    let schema = reader.schema();
    let batches = reader.collect::<Result<Vec<_>, _>>().map_err(error)?;
    Ok((schema, batches))
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::Int32Array;
    use arrow_schema::{DataType, Field};

    fn numbers(values: &[i32]) -> (SchemaRef, RecordBatch) {
        let schema: SchemaRef = Arc::new(Schema::new(vec![Field::new("n", DataType::Int32, true)]));
        let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(values.to_vec()))]).unwrap();
        (schema, batch)
    }

    #[test]
    fn round_trips_a_result() {
        let (schema, batch) = numbers(&[1, 2]);
        let bytes = write_stream(&schema, &[batch.clone(), batch]).unwrap();
        let (read_schema, batches) = read_stream(&bytes).unwrap();
        assert_eq!(read_schema, schema);
        assert_eq!(batches.iter().map(RecordBatch::num_rows).sum::<usize>(), 4);
        let empty = write_stream(&schema, &[]).unwrap();
        let (read_schema, batches) = read_stream(&empty).unwrap();
        assert_eq!((read_schema, batches.len()), (schema, 0));
        assert!(read_stream(b"no arrow").is_err());
    }

    #[test]
    fn the_parts_of_a_stream_are_one_stream() {
        let (schema, batch) = numbers(&[1, 2, 3]);
        let mut writer = IpcStreamWriter::new(&schema).unwrap();
        let first = writer.write(&batch).unwrap();
        let second = writer.write(&batch).unwrap();
        let last = writer.finish().unwrap();
        // The schema goes with the first part only, the last part is the end-of-stream marker
        assert!(first.len() > second.len());
        assert_eq!(last, [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
        let (_, batches) = read_stream(&[first, second, last].concat()).unwrap();
        assert_eq!(batches.iter().map(RecordBatch::num_rows).sum::<usize>(), 6);
    }
}
