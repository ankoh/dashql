/**
 * Step 5 of the order pipeline, reads the stream of step 4.
 *
 * Repeat until `status` is `ACTIVE`, then check the fields of its data lake object.
 */

call cdp.datastream_get (record_id_or_developer_name => 'Orders_snow', include_mappings => 'true');

call cdp.dlo_get (record_id_or_developer_name => 'Orders_snow__dll');
