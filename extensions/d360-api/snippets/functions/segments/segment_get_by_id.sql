/**
 * Read one segment when you hold its `1sg` id instead of its name.
 *
 * The id is the `market_segment_id`, not the `3HX` definition id or the `0gj` id of the object the segment is on. Find the id with `segment_get`.
 */

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers', dataspace => 'default');

call cdp.segment_get_by_id (segment_id => '1sgxx00000000PpAAI');
