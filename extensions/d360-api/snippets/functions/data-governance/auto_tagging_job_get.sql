/**
 * Follow one auto tagging job to see its progress and status.
 *
 * The id is a `job_id` that `tag_suggestions_generate` returned. Find it in the list when you lost it.
 */

call cdp.auto_tagging_job_list (object_name => 'Individual_DLO__dll', status => 'InProgress');

call cdp.auto_tagging_job_get (id => '1dj000000000001');
