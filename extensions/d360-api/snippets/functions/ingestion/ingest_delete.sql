/**
 * Delete up to 200 records of an object by primary key, as a streaming delete.
 *
 * `ids` is one comma-separated string. Use a bulk job with the operation `delete` for more. If the stream has a Record Modified field, a record is deleted only if that field allows it. The docs name no status call, so query the object after processing.
 */

call cdp.ingest_delete (
    name => 'ecomm',
    object_name => 'Orders',
    ids => 'f19cae7e-5cdb-41ce-92ba-539afea04f9d,48c8b6a6-8179-4a15-ba19-ec5c8206ce28'
);
