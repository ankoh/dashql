//! The Arrow IPC stream of a result that arrives in chunks.
//!
//! The first chunk of a result holds the schema, the later ones leave it out (`omitSchema`). The decoder reads the
//! chunks as one stream: it frames the messages itself and decodes them with the schema and the dictionaries so far.
//! A schema after the first and an end-of-stream marker inside a chunk are skipped, so a server that repeats the schema
//! or ends every chunk still yields one stream. A message may span chunks.

use std::collections::HashMap;
use std::sync::Arc;

use arrow_array::{ArrayRef, RecordBatch};
use arrow_buffer::Buffer;
use arrow_ipc::MessageHeader;
use arrow_schema::SchemaRef;

use super::error::HyperError;

/// The continuation marker in front of the length of a message
const CONTINUATION_MARKER: [u8; 4] = [0xff; 4];

/// A decoder of an Arrow IPC stream that arrives in chunks
#[derive(Debug, Default)]
pub struct ChunkedStreamDecoder {
    /// The schema, once a chunk had it
    schema: Option<SchemaRef>,
    /// The dictionaries by id
    dictionaries: HashMap<i64, ArrayRef>,
    /// The bytes of a message that the chunks so far hold only in part
    pending: Vec<u8>,
}

/// The frame of the next message in a buffer
enum Frame {
    /// A message: the offset of its metadata, the length of its metadata and the length of the whole frame
    Message { metadata_offset: usize, metadata_length: usize, length: usize },
    /// The end-of-stream marker of a length
    EndOfStream { length: usize },
    /// The buffer holds only part of the next message
    Incomplete,
}

fn arrow_error(e: arrow_schema::ArrowError) -> HyperError {
    HyperError::Protocol(format!("invalid Arrow stream: {e}"))
}

fn invalid_message(e: impl std::fmt::Display) -> HyperError {
    HyperError::Protocol(format!("invalid Arrow message: {e}"))
}

/// A little-endian `u32` at an offset
fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let word: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(word))
}

/// Find the frame of the next message
fn next_frame(bytes: &[u8]) -> Result<Frame, HyperError> {
    let Some(first) = read_u32(bytes, 0) else {
        return Ok(Frame::Incomplete);
    };
    // A stream of the format before 0.15 has no continuation marker
    let (prefix, metadata_length) = if bytes.get(..4) == Some(&CONTINUATION_MARKER[..]) {
        match read_u32(bytes, 4) {
            Some(length) => (8, length as usize),
            None => return Ok(Frame::Incomplete),
        }
    } else {
        (4, first as usize)
    };
    if metadata_length == 0 {
        return Ok(Frame::EndOfStream { length: prefix });
    }
    let too_long = || invalid_message("a message longer than the address space");
    let metadata_end = prefix.checked_add(metadata_length).ok_or_else(too_long)?;
    let Some(metadata) = bytes.get(prefix..metadata_end) else {
        return Ok(Frame::Incomplete);
    };
    let message = arrow_ipc::root_as_message(metadata).map_err(invalid_message)?;
    let body_length = usize::try_from(message.bodyLength()).map_err(|_| invalid_message("a negative body length"))?;
    let length = metadata_end.checked_add(body_length).ok_or_else(too_long)?;
    if bytes.len() < length {
        return Ok(Frame::Incomplete);
    }
    Ok(Frame::Message { metadata_offset: prefix, metadata_length, length })
}

impl ChunkedStreamDecoder {
    /// A decoder before the first chunk
    pub fn new() -> Self {
        Self::default()
    }

    /// The schema, once a chunk had it
    pub fn schema(&self) -> Option<SchemaRef> {
        self.schema.clone()
    }

    /// Decode a message, returns its record batch if it is one
    fn decode_message(&mut self, metadata: &[u8], body: &[u8]) -> Result<Option<RecordBatch>, HyperError> {
        let message = arrow_ipc::root_as_message(metadata).map_err(invalid_message)?;
        let version = message.version();
        match message.header_type() {
            MessageHeader::Schema => {
                // A schema after the first one repeats it
                if self.schema.is_none() {
                    let schema =
                        message.header_as_schema().ok_or_else(|| invalid_message("a schema without schema"))?;
                    self.schema = Some(Arc::new(arrow_ipc::convert::try_fb_to_schema(schema).map_err(arrow_error)?));
                }
                Ok(None)
            }
            MessageHeader::RecordBatch => {
                let schema = self.schema.clone().ok_or_else(|| invalid_message("a record batch before the schema"))?;
                let batch =
                    message.header_as_record_batch().ok_or_else(|| invalid_message("a record batch without batch"))?;
                let body = Buffer::from(body.to_vec());
                arrow_ipc::reader::read_record_batch(&body, batch, schema, &self.dictionaries, None, &version)
                    .map(Some)
                    .map_err(arrow_error)
            }
            MessageHeader::DictionaryBatch => {
                let schema = self.schema.clone().ok_or_else(|| invalid_message("a dictionary before the schema"))?;
                let dictionary = message
                    .header_as_dictionary_batch()
                    .ok_or_else(|| invalid_message("a dictionary without batch"))?;
                let body = Buffer::from(body.to_vec());
                arrow_ipc::reader::read_dictionary(&body, dictionary, &schema, &mut self.dictionaries, &version)
                    .map_err(arrow_error)?;
                Ok(None)
            }
            MessageHeader::NONE => Ok(None),
            other => Err(invalid_message(format!("an unsupported message {other:?}"))),
        }
    }

    /// Decode a chunk, returns the record batches it completes
    pub fn decode(&mut self, chunk: &[u8]) -> Result<Vec<RecordBatch>, HyperError> {
        let mut pending = std::mem::take(&mut self.pending);
        pending.extend_from_slice(chunk);
        let mut batches = Vec::new();
        let mut offset = 0;
        let result = loop {
            let rest = pending.get(offset..).unwrap_or_default();
            match next_frame(rest) {
                Err(e) => break Err(e),
                Ok(Frame::Incomplete) => break Ok(()),
                Ok(Frame::EndOfStream { length }) => offset += length,
                Ok(Frame::Message { metadata_offset, metadata_length, length }) => {
                    let metadata = rest.get(metadata_offset..metadata_offset + metadata_length).unwrap_or_default();
                    let body = rest.get(metadata_offset + metadata_length..length).unwrap_or_default();
                    offset += length;
                    match self.decode_message(metadata, body) {
                        Ok(Some(batch)) => batches.push(batch),
                        Ok(None) => {}
                        Err(e) => break Err(e),
                    }
                }
            }
        };
        pending.drain(..offset.min(pending.len()));
        self.pending = pending;
        result.map(|()| batches)
    }

    /// End the stream, an error if a message is incomplete
    pub fn finish(&mut self) -> Result<(), HyperError> {
        if !self.pending.is_empty() {
            return Err(HyperError::Protocol(format!(
                "the Arrow stream ends inside a message, {} bytes are left",
                self.pending.len()
            )));
        }
        Ok(())
    }
}

/// Read a whole Arrow IPC stream, e.g. the body of a rows response
pub fn decode_stream(bytes: &[u8]) -> Result<(Option<SchemaRef>, Vec<RecordBatch>), HyperError> {
    let mut decoder = ChunkedStreamDecoder::new();
    let batches = decoder.decode(bytes)?;
    decoder.finish()?;
    Ok((decoder.schema(), batches))
}
