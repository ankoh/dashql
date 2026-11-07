/**
 * Get a time-limited link to try an experience config on a mobile app before you deploy it.
 *
 * Send either `experience_config` or `transformer`, not both. `decision_request_body` names the decision, cohort and experiment (`p`) and the individual and anchor (`c`) the preview renders for. The result has the `preview_url` and when it expires in `expires_at`. The app needs a custom URL schema configured for live previews.
 */

call cdp.p13n_mobile_preview_create (
    data_connector_id => 'mobile_app_connector_123',
    experience_config => (
        name = 'test_experience',
        label = 'Test Experience',
        data_provider = (type = 'PersonalizationPoint', reference_type = 'ApiName', value = 'product_recs'),
        source_matchers = [(type = 'ContentZone', value = 'product_list')],
        transformation_config = (
            when = 'Immediately',
            method = 'ReplaceContentZoneContent',
            transformations = [(transformer_name = 'product_card_transformer')]
        )
    ),
    decision_request_body => (
        p = (decision_id = 'rec_decision_001', cohort_id = 'cohort_A', experiment_id = 'exp_123'),
        c = (individual_id = 'ind_456', anchor_id = 'anchor_789')
    )
);
