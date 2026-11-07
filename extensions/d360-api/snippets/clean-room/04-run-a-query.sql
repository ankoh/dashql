/**
 * Step 4 of the clean room.
 *
 * Run the template on `:collaboration_name`.
 */

call cdp.clean_room_query_run (
    collaboration_id_or_api_name => :collaboration_name,
    query_execution_name => 'overlap_run_1',
    query_parameters => (threshold_count = '4')
);
