/**
 * Generate the key that signs the requests sent to a webhook target, so the receiver can verify them.
 *
 * The result holds the key in clear text: copy it to the receiver and don't keep the row. Don't retry blindly, a second call resets the key, and a new key takes up to 15 minutes to take effect.
 */

call cdp.dataaction_target_get (api_name => 'contact_webhook');

call cdp.dataaction_target_signing_key_generate (api_name => 'contact_webhook');
