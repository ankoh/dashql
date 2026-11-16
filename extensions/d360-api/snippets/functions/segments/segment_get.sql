/**
 * Read one segment by its API name to check `segment_status` and `publish_status`, and to copy the `market_segment_id` that publishing needs.
 *
 * The single segment comes back wrapped like a list, so the result has the same shape as `segment_list`.
 */

call d360.segment_list (dataspace => 'default', filters => 'SegmentStatus eq Active');

call d360.segment_get (segment_api_name => 'High_Value_Order_Buyers', dataspace => 'default');
