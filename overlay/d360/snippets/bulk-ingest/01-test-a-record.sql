/**
 * Step 1 of bulk ingestion. It needs an Ingestion API connector `ecomm`, its schema with the object `Orders`, and a data stream.
 *
 * Validate a record without storing it.
 */

CALL cdp.ingest_test (name => 'ecomm', object_name => 'Orders', data => [(id = 'o-1', total = 77506)]);
