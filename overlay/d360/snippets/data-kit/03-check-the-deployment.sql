/**
 * Step 3 of the data kit.
 *
 * Repeat with `:job_id` until the deployment finished.
 */

CALL cdp.datakit_deploy_status (job_id => :job_id);
