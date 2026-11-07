/**
 * Read the schemas defined on a connection, the objects and fields an Ingestion API or Streaming App connection accepts.
 *
 * Only some connector types work: `DataConnectionEvent`, `IngestApi` and `StreamingApp`. Others, such as `AwsS3` or `SalesforceDotCom`, are rejected with an illegal query parameter error.
 */

call cdp.connection_schema_list (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_endpoint_list (connection_id => '9cgaj0000012O5hAAE');
