-- @description
-- Rank documents by the cosine similarity of their embeddings to a query embedding.
-- @end

with documents(title, embedding) as (
    values
        ('Recursive queries', cast(array[0.9, 0.1, 0.0] as real[])),
        ('Window functions', cast(array[0.7, 0.6, 0.1] as real[])),
        ('Property graphs', cast(array[0.8, 0.0, 0.5] as real[])),
        ('Date arithmetic', cast(array[0.0, 0.9, 0.3] as real[]))
)
select title, cosine_similarity(embedding, cast(array[1.0, 0.0, 0.3] as real[])) as similarity
from documents
order by similarity desc
limit 3;
