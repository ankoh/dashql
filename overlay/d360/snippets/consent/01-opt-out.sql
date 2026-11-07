/**
 * Step 1 of consent.
 *
 * Record that a person opted out of processing.
 */

call cdp.consent_update (action => 'processing', ids => '100000695', mode => 'cdp', status => 'optout');
