/**
 * Check the auto tagging jobs of one object, filtered by their state.
 *
 * `status` is `InProgress`, `Success` or `Fail`. Jobs come from `tag_suggestions_generate`.
 */

call cdp.auto_tagging_job_list (object_name => 'Individual_DLO__dll', status => 'Success', limit => 50);
