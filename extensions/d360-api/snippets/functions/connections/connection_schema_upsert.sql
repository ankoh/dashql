/**
 * Define the schema of an Ingestion API connection: an object with its fields and their types. The connection is incomplete until this has run.
 *
 * Always send the field `label`, the server fails without it. The schema is effectively immutable, adding a field means a new schema, stream and mapping. A stream's source object must match the schema `name`.
 */

call cdp.connection_schema_upsert (
    connection_id => '9cgaj0000012O5hAAE',
    schemas => [(
        name = 'Orders',
        label = 'Orders',
        schema_type = 'IngestApi',
        fields = [
            (name = 'Id', label = 'Id', data_type = 'Text'),
            (name = 'Amount', label = 'Amount', data_type = 'Number'),
            (name = 'OrderedAt', label = 'OrderedAt', data_type = 'DateTime')
        ]
    )]
);

call cdp.connection_schema_list (connection_id => '9cgaj0000012O5hAAE');
