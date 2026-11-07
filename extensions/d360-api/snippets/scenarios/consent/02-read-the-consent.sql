/**
 * Step 2 of consent.
 *
 * Read it back.
 */

call cdp.consent_get (action => 'processing', ids => '100000695', mode => 'cdp');
