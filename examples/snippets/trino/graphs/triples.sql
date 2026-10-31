/**
 * @description
 * Store facts as subject-predicate-object triples and join them like a SPARQL query.
 * Finds the authors of books in the genre science fiction and their birth year.
 */

with triples(subject, predicate, object) as (
    values
        ('dune', 'type', 'book'),
        ('dune', 'genre', 'science fiction'),
        ('dune', 'author', 'herbert'),
        ('emma', 'type', 'book'),
        ('emma', 'genre', 'novel'),
        ('emma', 'author', 'austen'),
        ('herbert', 'name', 'Frank Herbert'),
        ('herbert', 'born', '1920'),
        ('austen', 'name', 'Jane Austen'),
        ('austen', 'born', '1775')
)
select book.subject as book, name.object as author, cast(born.object as integer) as born
from triples book
join triples genre on genre.subject = book.subject and genre.predicate = 'genre'
join triples author on author.subject = book.subject and author.predicate = 'author'
join triples name on name.subject = author.object and name.predicate = 'name'
join triples born on born.subject = author.object and born.predicate = 'born'
where book.predicate = 'type' and book.object = 'book'
    and genre.object = 'science fiction';
