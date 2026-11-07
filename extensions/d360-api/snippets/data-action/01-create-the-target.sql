/**
 * Step 1 of the data action.
 *
 * Create the webhook that receives the action.
 */

call cdp.dataaction_target_create (
    type => 'WebHook',
    label => 'Contact webhook',
    api_name => 'contact_webhook',
    config => (target_endpoint = 'https://hooks.example.com/data360')
);
