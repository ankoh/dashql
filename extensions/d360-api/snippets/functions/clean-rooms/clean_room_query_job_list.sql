/**
 * Poll the query jobs of a collaboration, newest first. This is the only way to see whether a job finished: there is no call that gets one job.
 *
 * Read `status` (`Created`, `Running`, `Success` or `Failed`) and, for a failed job, `error_code` and `error_message`. A job can fail on setup, for example because a member has no specification.
 */

call cdp.clean_room_query_job_list (
    collaboration_id_or_api_name => 'collab21_00DSB00000eMue3',
    order_by => 'created_date DESC',
    limit => 20,
    _pages => 2
);
