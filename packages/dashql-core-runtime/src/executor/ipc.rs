//! Results as Arrow IPC streams: what crosses between the executor and the host.

use std::sync::Arc;

use arrow_array::RecordBatch;
use arrow_ipc::writer::StreamWriter;
use arrow_schema::{Schema, SchemaRef};

use crate::hyper::decode_stream;

/// Write a schema and its batches as one Arrow IPC stream
pub fn write_stream(schema: &SchemaRef, batches: &[RecordBatch]) -> Result<Vec<u8>, String> {
    let error = |e: arrow_schema::ArrowError| format!("failed to write the result: {e}");
    let mut writer = StreamWriter::try_new(Vec::new(), schema).map_err(error)?;
    for batch in batches {
        writer.write(batch).map_err(error)?;
    }
    writer.finish().map_err(error)?;
    writer.into_inner().map_err(error)
}

/// Read an Arrow IPC stream: its schema, an empty one without, and its batches
pub fn read_stream(bytes: &[u8]) -> Result<(SchemaRef, Vec<RecordBatch>), String> {
    let (schema, batches) = decode_stream(bytes).map_err(|e| format!("failed to read a result batch: {}", e.message()))?;
    let schema = schema.or_else(|| batches.first().map(RecordBatch::schema)).unwrap_or_else(|| Arc::new(Schema::empty()));
    Ok((schema, batches))
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::Int32Array;
    use arrow_schema::{DataType, Field};

    #[test]
    fn round_trips_a_result() {
        let schema: SchemaRef = Arc::new(Schema::new(vec![Field::new("n", DataType::Int32, true)]));
        let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(vec![1, 2]))]).unwrap();
        let bytes = write_stream(&schema, &[batch.clone(), batch]).unwrap();
        let (read_schema, batches) = read_stream(&bytes).unwrap();
        assert_eq!(read_schema, schema);
        assert_eq!(batches.iter().map(RecordBatch::num_rows).sum::<usize>(), 4);
        let empty = write_stream(&schema, &[]).unwrap();
        let (read_schema, batches) = read_stream(&empty).unwrap();
        assert_eq!((read_schema, batches.len()), (schema, 0));
        assert!(read_stream(b"no arrow").is_err());
    }
}
