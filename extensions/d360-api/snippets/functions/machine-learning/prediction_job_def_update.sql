/**
 * Change a prediction job definition: its label, description and the settings of its binary classification. Most fields can't change while the definition is `Active`, so deactivate it first and activate it again after the edit.
 *
 * This call sets the definition inactive and edits it. Activation has no call of its own, it is this update with `activation_status`.
 */

call cdp.prediction_job_def_update (
    prediction_job_def_id_or_name => 'attrition_scores',
    activation_status => 'Inactive',
    label => 'Attrition Scores',
    description => 'Scores every employee for the risk of leaving.',
    binary_classification_settings => (
        max_top_contributors = 5,
        max_prescriptions = 3,
        prescription_threshold = 25,
        show_class_probabilities = true
    )
);

call cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
