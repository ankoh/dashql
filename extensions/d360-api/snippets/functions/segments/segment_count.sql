/**
 * Start a count of the segment's members now.
 *
 * The call starts a job and the answer carries no count. `last_segment_member_count` of `segment_get` is the only count column, and the docs don't say that this call updates it. Counting a segment that was just created can fail, so check `segment_status` first. The approximate count needs a feature that may not be enabled, hence `false`.
 */

call cdp.segment_count (segment_api_name => 'High_Value_Order_Buyers', prefer_approx_count => false);

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers');
