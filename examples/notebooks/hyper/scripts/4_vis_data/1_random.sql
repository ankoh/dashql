from generate_series(1, 100) t(v)
|> select v as x, random() as y
