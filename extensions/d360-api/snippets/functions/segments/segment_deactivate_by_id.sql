/**
 * Stop a segment when you hold its `1sg` id.
 *
 * It does the same as `segment_deactivate`. Read the segment first to check the id.
 */

call d360.segment_get_by_id (segment_id => '1sgxx00000000PpAAI');

call d360.segment_deactivate_by_id (segment_id => '1sgxx00000000PpAAI');
