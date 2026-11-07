/**
 * Step 3 of the data action.
 *
 * Generate the key that signs the requests to the webhook.
 */

call cdp.dataaction_target_signing_key_generate (api_name => 'contact_webhook');
