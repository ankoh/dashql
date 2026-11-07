/**
 * Publish a segment, which calculates its membership.
 *
 * Publishing needs the `market_segment_id` (`1sg...`) from `segment_get`, not the name. The answer says `PUBLISHING` and its `errors` holds an empty object even on success, so check `success`. Poll `publish_status` afterwards, which ends as `PUBLISHED` or `SUCCESS` depending on the source.
 */

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers');

call cdp.segment_publish (segment_id => '1sgxx00000000PpAAI');

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers');
