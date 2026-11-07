/**
 * Accept a data alert of a trained model, so that its directives are applied on the next setup version. Find the alert first by querying the alerts of the model artifact.
 *
 * Send only one of `accepted` or `dismissed`. Accepting takes effect when you create the next version with `source_setup_version_number` set to the current version, and dismissing hides the alert without applying anything.
 */

call cdp.ml_alerts_query (
    asset => 'Attrition_Risk_Predictor_v1__mla',
    asset_type => 'ModelArtifact',
    source_types => ['ModelTraining']
);

call cdp.ml_alert_update (alert_id => '1AdSB0000000ZtR0AU', accepted => true);
