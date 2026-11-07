/**
 * Step 13 of the order pipeline, publishes the segment of step 12.
 *
 * Wait for `segment_status` to be `ACTIVE`, and take `:market_segment_id` from the first call. Publishing takes minutes, read the members after it finishes.
 */

CALL cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers', dataspace => 'default');
CALL cdp.segment_publish (segment_id => :market_segment_id);
CALL cdp.segment_member_list (segment_api_name => 'High_Value_Order_Buyers', limit => 100);
