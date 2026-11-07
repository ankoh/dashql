/**
 * Point an existing target at a new endpoint URL and rename it.
 *
 * Set only the attributes that apply to the target type. This path isn't in the public spec, it comes from Salesforce's MCP source, so read the target afterwards to see what took effect.
 */

call cdp.dataaction_target_update (
    target_api_name => 'contact_webhook',
    label => 'Contact webhook v2',
    config => (target_endpoint = 'https://hooks.example.com/data360/v2')
);

call cdp.dataaction_target_get (api_name => 'contact_webhook');
