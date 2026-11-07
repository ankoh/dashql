/**
 * Define a batch job that scores a data model object with a model and writes the scores to a new output object. Definitions start `Inactive`, so activate it with `prediction_job_def_update` before you run it.
 *
 * `input_config` maps each field the model was trained on to a field of the data object, along a relationship path when the field lives in a related object. The settings must match the job type: here `binary_classification_settings` for `BinaryClassification`.
 */

call cdp.prediction_job_def_create (
    type => 'BinaryClassification',
    label => 'Attrition Scores',
    api_name => 'attrition_scores',
    description => 'Scores every employee for the risk of leaving.',
    model => (id = '12lSB000000UWdZYAW'),
    output_config => (object_name = 'Attrition_Scores', description = 'Attrition scores per employee'),
    scoring_mode => 'Batch',
    input_config => (
        data_object = (id = '0gjSB00000SQccbYAD'),
        fields = [(
            model_field = (id = '0xmSB0000008UovYAE'),
            mapped_field = (
                id = '0gYSB00006XqM852AF',
                data_object = (id = '0gjSB00000SQccbYAD'),
                relationship_path = [(
                    source_field = (id = '0gYSB00006XqM8F2AV', data_object = (id = '0gjSB00000SQccbYAD')),
                    target_field = (id = '0gYSB00006W3U0t2AF', data_object = (id = '0gjSB00000SJ2xFYAT'))
                )]
            ),
            update_score = true
        )]
    ),
    binary_classification_settings => (
        max_top_contributors = 3,
        max_prescriptions = 3,
        prescription_threshold = 22,
        show_class_probabilities = true
    )
);

call cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
