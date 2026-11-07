/**
 * Check records against the schema of an object before sending them.
 *
 * Nothing is loaded, and it is meant for development only. A failure is an HTTP 400 whose `details.validationReport` lists each record with the exceptions that rejected it, such as a wrong type.
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
