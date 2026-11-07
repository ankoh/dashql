/**
 * Confirm the Data Cloud Tenant Specific Endpoint of the org before you set up personalization, and see which experience configs a connector already has.
 *
 * The call also serves as a feature check: Salesforce tooling probes this path to see whether personalization is available in an org.
 */

call cdp.p13n_org_info_get ();

call cdp.p13n_experience_config_list (id_or_app_source_id_or_name => 'my_website_connector');
