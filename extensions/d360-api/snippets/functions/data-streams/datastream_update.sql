/**
 * Change the label and the refresh schedule of a data stream. Only the attributes you pass change.
 *
 * The update returns with the status `PROCESSING`. Read the stream until it is `ACTIVE` again.
 */

call cdp.datastream_update (
    record_id_or_developer_name => 'Bookings',
    label => 'Bookings (daily)',
    refresh_config => (refresh_mode = 'UPSERT', frequency = (frequency_type = 'DAILY', hours = [6]))
);

call cdp.datastream_get (record_id_or_developer_name => 'Bookings');
