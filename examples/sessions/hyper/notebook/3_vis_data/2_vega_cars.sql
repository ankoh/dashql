-- Fetch vega cars
-- R2 key is read-only and public

select *
from external(
    s3_location(
        's3://dashql-data/vega-cars/v1/cars.parquet',
        endpoint => 'https://875b6eb3578b597278be32b1d4b3b316.r2.cloudflarestorage.com',
        region => 'auto',
        access_key_id => '2324f785f4f1b307e3760421439fb8cd',
        secret_access_key => 'ef4cff58cc2294aca6ee003ce113e06f6b0b79c20d3603fe19d441fe020c4eda'
    ), format => 'parquet')