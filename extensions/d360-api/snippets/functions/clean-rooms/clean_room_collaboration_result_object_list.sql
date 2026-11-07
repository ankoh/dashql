/**
 * List the data model objects a collaboration created from its query results, once a job has succeeded.
 *
 * The names end in `__dlm`. Reading from a member whose invitation is not in a valid state to run queries fails with a 400.
 */

call cdp.clean_room_query_job_list (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3', limit => 5);

call cdp.clean_room_collaboration_result_object_list (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');
