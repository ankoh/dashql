/**
 * Step 3 of the data action.
 *
 * Generate the key that signs the requests to the webhook.
 */

call d360.dataaction_target_signing_key_generate (api_name => 'contact_webhook');
