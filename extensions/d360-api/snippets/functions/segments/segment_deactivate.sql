/**
 * Stop a segment, by its API name.
 *
 * It is the inverse of publish. Read the segment first. A segment created a moment ago can fail with `We couldn't publish your segment` until its status is `ACTIVE`.
 */

call d360.segment_get (segment_api_name => 'High_Value_Order_Buyers');

call d360.segment_deactivate (segment_api_name => 'High_Value_Order_Buyers');
