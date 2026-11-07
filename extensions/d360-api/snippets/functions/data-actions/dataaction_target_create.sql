/**
 * Create a webhook target that data actions can send their events to.
 *
 * Creation is asynchronous: the response shows `PROCESSING`, so read the target until its `status` is `Active`. `Error` is final, with the reason in `status_error_code`. A webhook gets no payloads until you generate its signing key.
 */

call cdp.dataaction_target_create (
    type => 'WebHook',
    sub_type => 'Rest',
    label => 'Contact webhook',
    api_name => 'contact_webhook',
    config => (target_endpoint = 'https://hooks.example.com/data360')
);

call cdp.dataaction_target_get (api_name => 'contact_webhook');
