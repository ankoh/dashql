/**
 * Run one of the template's queries on an active collaboration, here with a minimum group size.
 *
 * Parameter values are strings, also when the template declares an `INTEGER`. The result has the `id` of the job: look for it in the job list, and read `status`, `error_code` and `error_message` there.
 */

call cdp.clean_room_query_run (
    collaboration_id_or_api_name => 'collab21_00DSB00000eMue3',
    query_execution_name => 'rawtalks1',
    query_parameters => (threshold_count = '4')
);

call cdp.clean_room_query_job_list (
    collaboration_id_or_api_name => 'collab21_00DSB00000eMue3',
    order_by => 'created_date DESC',
    limit => 5
);
