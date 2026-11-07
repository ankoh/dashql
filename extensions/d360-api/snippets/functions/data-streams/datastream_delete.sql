/**
 * Delete a data stream and, when asked, its data lake object. Read the stream first and note the name of its DLO, which can't be looked up afterwards.
 *
 * `should_delete_data_lake_object` defaults to false. With true the call can return 204 and still leave the DLO in place while something references it, such as a mapping, so don't trust the 204.
 */

call cdp.datastream_get (record_id_or_developer_name => 'Orders_snow');

call cdp.datastream_delete (record_id_or_developer_name => 'Orders_snow', should_delete_data_lake_object => true);
