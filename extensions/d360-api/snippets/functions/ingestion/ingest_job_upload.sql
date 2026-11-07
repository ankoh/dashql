/**
 * Add one CSV file to an open job, then close the job so its data is processed.
 *
 * Call it once per file: a job takes up to 100 files of 150 MB each, one at a time. The CSV is the whole request body, and its first line is the header, so it starts right after the opening quotes. Nothing is processed until the job is closed.
 */

call cdp.ingest_job_upload (
    id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab',
    csv => $$id,contact_name,created_date,tax_exempt,total
f19cae7e-5cdb-41ce-92ba-539afea04f9d,Jadyn Kozey,2021-07-22T08:57:08.118Z,false,77506
48c8b6a6-8179-4a15-ba19-ec5c8206ce28,Kristina Jakubowski,2021-07-08T22:57:02.008Z,false,16986
$$
);

call cdp.ingest_job_update (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab', state => 'UploadComplete');
