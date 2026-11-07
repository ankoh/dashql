/**
 * Poll a deploy job until it reaches a final status.
 *
 * `job_status` is `Complete` or `Completed` with an empty `errors` when it worked. A failed job can report `Error` and not `Failed`, so check `Failed`, `Cancelled` and `Aborted` as well. The call isn't in the spec.
 */

call cdp.datakit_deploy_status (job_id => '08Paj00000tPyr4');

call cdp.datakit_component_status (data_kit_name => 'Customer_Kit', component_name => 'Customer__dll');
