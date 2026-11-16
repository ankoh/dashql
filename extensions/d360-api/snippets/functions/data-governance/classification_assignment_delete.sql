/**
 * Take away one link between a classification and a tag.
 *
 * The link is read by its id first. Only the link goes, the classification and the tag stay.
 */

call d360.classification_assignment_get (id => '9aa000000000050');

call d360.classification_assignment_delete (id => '9aa000000000050');
