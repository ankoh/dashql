/**
 * Send a few new or changed records to an object in near real time, as a streaming upsert.
 *
 * Use it for small micro-batches and a bulk job for large loads. The body can be 200 KB at most. Keys are the field names of the uploaded schema. The 202 only means the request was accepted: processing runs about every 3 minutes, so query the object later. The first call validates the same records without loading them.
 */

call cdp.ingest_test (
    name => 'ecomm',
    object_name => 'Orders',
    data => [
        (
            id = 'f19cae7e-5cdb-41ce-92ba-539afea04f9d',
            contact_name = 'Joe Smith',
            created_date = '2021-07-22T08:57:08.118Z',
            tax_exempt = false,
            total = 77506
        ),
        (
            id = '48c8b6a6-8179-4a15-ba19-ec5c8206ce28',
            contact_name = 'Kristina Jakubowski',
            created_date = '2021-07-08T22:57:02.008Z',
            tax_exempt = true,
            total = 16986
        )
    ]
);

call cdp.ingest_insert (
    name => 'ecomm',
    object_name => 'Orders',
    data => [
        (
            id = 'f19cae7e-5cdb-41ce-92ba-539afea04f9d',
            contact_name = 'Joe Smith',
            created_date = '2021-07-22T08:57:08.118Z',
            tax_exempt = false,
            total = 77506
        ),
        (
            id = '48c8b6a6-8179-4a15-ba19-ec5c8206ce28',
            contact_name = 'Kristina Jakubowski',
            created_date = '2021-07-08T22:57:02.008Z',
            tax_exempt = true,
            total = 16986
        )
    ]
);
