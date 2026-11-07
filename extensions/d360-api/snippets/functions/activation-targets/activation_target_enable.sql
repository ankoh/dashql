/**
 * Switch a disabled target on again, then read it to see the outcome.
 *
 * It takes the 18-character record id. Read `success` in the result. For Google Ads the setup in the UI ends with an enable click, and no source says whether this call replaces it.
 */

call cdp.activation_target_enable (activation_target_id => '85UVF000000Dr4v2AC', dataspace => 'default');

call cdp.activation_target_get (activation_target_id => '85UVF000000Dr4v2AC');
