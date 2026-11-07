/**
 * Rename a model or change its description. Data objects, relationships and calculated fields stay as they are.
 */

call cdp.sdm_update (
    model_api_name_or_id => 'AccountRevenue',
    label => 'Account Revenue (sales)',
    description => 'Accounts and revenue, used by the sales dashboard'
);

call cdp.sdm_get (model_api_name_or_id => 'AccountRevenue');
