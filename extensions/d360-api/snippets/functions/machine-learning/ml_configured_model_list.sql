/**
 * Find the predictive configured models built with the no-code model builder. Use it to check what is available to score against.
 *
 * The filters work together. Leave the asset options out to list every configured model.
 */

call cdp.ml_configured_model_list (
    model_type => 'Predictive',
    capabilities => 'BinaryClassification',
    source_type => 'EdcNoCode',
    out_of_the_box => false,
    search => 'Attrition',
    limit => 25
);
