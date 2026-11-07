/**
 * Delete a segment for good.
 *
 * It takes the `api_name`, not the `1sg` id. The call answers 204 even while the segment is still `PROCESSING`, so read it first to see what you are deleting.
 */

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers', dataspace => 'default');

call cdp.segment_delete (segment_api_name => 'High_Value_Order_Buyers');
