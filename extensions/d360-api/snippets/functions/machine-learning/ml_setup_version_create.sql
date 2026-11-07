/**
 * Define a version of a model setup: the data it learns from, the outcome to predict and the fields to use. Reach for it after the inspection calls told you the data is fit to train on.
 *
 * Pass each field as `ml_query_setup_fields` returned it. The platform needs at least three fields and 400 rows after filters. The call leaves the version in `Draft` and trains nothing, check `status` in the result and then send `Training` with `ml_setup_version_update`.
 */

call cdp.ml_setup_version_create (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    type => 'EdcNoCode',
    description => 'First version of the attrition model.',
    input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default')),
    outcomes => [(
        type = 'Binary',
        name = 'Attrition__c',
        label = 'Attrition',
        goal = 'Minimize',
        success_value = 'Yes',
        failure_value = 'No'
    )],
    fields => [
        (
            type = 'Number',
            name = 'Age__c',
            min = 18,
            max = 60,
            bucketing_strategy = (type = 'Percentile', number_of_buckets = 10)
        ),
        (
            type = 'Number',
            name = 'Monthly_Income__c',
            min = 1009,
            max = 19999,
            bucketing_strategy = (type = 'Percentile', number_of_buckets = 10)
        ),
        (
            type = 'Text',
            name = 'Over_Time__c',
            data_type = 'Categorical',
            ordering = 'Occurrence',
            include_other = true,
            balanced = false
        )
    ],
    field_selection => 'Manual',
    source_setup_version_number => 0
);
