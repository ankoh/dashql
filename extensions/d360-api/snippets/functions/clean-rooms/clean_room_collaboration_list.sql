/**
 * Find a collaboration and the invitations in it, newest first.
 *
 * `members[].invitationId` is the id that `clean_room_invitation_accept` and `clean_room_invitation_reject` need. `status` has to be `Active` before a query can run. Paging follows the next page URL, up to 20 collaborations a page.
 */

call cdp.clean_room_collaboration_list (order_by => 'created_date DESC', limit => 20, _pages => 2);
