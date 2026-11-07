/**
 * Create a data stream that reads a file from an S3 connection into a new data lake object on a weekly schedule. The body differs per connector, so this is the shape for S3.
 *
 * The create returns with the status `PROCESSING`. Read the stream until it is `ACTIVE`, then map the DLO. `Profile` and `Engagement` DLOs need a primary key.
 */

call cdp.datastream_create (
    name => 'Bike_Trips',
    label => 'Bike Trips',
    data_source => 'AwsS3_S3Connection',
    data_stream_type => 'CONNECTORSFRAMEWORK',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'S3Connection')),
    data_lake_object_info => (
        label = 'Bike Trips',
        name = 'Bike_Trips__dll',
        category = 'Profile',
        dataspace_info = [(name = 'default')],
        data_lake_field_input_representations = [
            (name = 'trip_id', label = 'trip_id', data_type = 'Number', is_primary_key = true),
            (name = 'starttime', label = 'starttime', data_type = 'DateTime', is_primary_key = false),
            (name = 'usertype', label = 'usertype', data_type = 'Text', is_primary_key = false)
        ]
    ),
    source_fields => [
        (name = 'trip_id', data_type = 'Number'),
        (name = 'starttime', data_type = 'DateTime'),
        (name = 'usertype', data_type = 'Text')
    ],
    mappings => [
        (source_field_label = 'trip_id', target_field_name = 'trip_id'),
        (source_field_label = 'starttime', target_field_name = 'starttime'),
        (source_field_label = 'usertype', target_field_name = 'usertype', target_field_returntype = 'Text')
    ],
    refresh_config => (
        refresh_mode = 'UPSERT',
        frequency = (frequency_type = 'WEEKLY', refresh_day_of_week = 'Sunday', hours = [7])
    ),
    advanced_attributes => (
        fileName = '*',
        fileType = 'CSV',
        importDirectory = 'trips',
        areHeadersIncludedInFile = true
    )
);

call cdp.datastream_get (record_id_or_developer_name => 'Bike_Trips');
