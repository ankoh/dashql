use arrow::ipc::reader::FileReader;
use std::io::Cursor;

use crate::error::SystemError;

pub fn read_arrow_ipc_buffer(buffer: &[u8]) -> Result<Vec<arrow::record_batch::RecordBatch>, SystemError> {
    let cursor = Cursor::new(buffer);
    let reader = FileReader::try_new(cursor, None).unwrap();
    let mut batches = Vec::new();
    for maybe_batch in reader {
        match maybe_batch {
            Ok(batch) => batches.push(batch),
            Err(err) => return Err(SystemError::Generic(err.to_string())),
        }
    }
    return Ok(batches);
}
