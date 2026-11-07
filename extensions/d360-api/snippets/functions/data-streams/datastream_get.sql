/**
 * Read one data stream with its refresh settings, source fields and status. Reach for it to see whether a stream is active and how its last run went.
 *
 * `include_mappings` returns the field mappings as well. Status values come back in uppercase, such as `ACTIVE`.
 */

call cdp.datastream_list (filter => 'SFDC', limit => 20);

call cdp.datastream_get (record_id_or_developer_name => 'Account_Home', include_mappings => 'true');
