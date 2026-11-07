/**
 * Start the AI to suggest tags for objects, from the tags of the taxonomies you name.
 *
 * One job starts per object and the call returns their `job_id`s. A job is done when its status is `Success` or `Fail`, it is `InProgress` until then. An object with a running job is refused.
 */

call cdp.tag_suggestions_generate (
    object_names => ['Individual_DLO__dll', 'Account_DLO__dll'],
    taxonomy_names => ['Compliance_Tags']
);

call cdp.auto_tagging_job_list (object_name => 'Individual_DLO__dll', status => 'InProgress');
