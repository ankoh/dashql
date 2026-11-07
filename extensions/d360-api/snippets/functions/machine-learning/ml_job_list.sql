/**
 * List the machine learning jobs of the org. Despite the name this covers training jobs as well as prediction jobs, and `type` picks which.
 *
 * The spec's `status`, `number_of_tasks` and `tasks_url` are not columns, read them from `_raw`.
 */

call cdp.ml_job_list (type => 'Prediction', limit => 25, offset => 0, _pages => 2);
