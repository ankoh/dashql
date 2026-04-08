mod imp {
    use std::ffi::CString;
    use std::slice;

    #[repr(C)]
    pub struct DuckDBWebFFIDatabase {
        _private: [u8; 0],
    }

    #[repr(C)]
    pub struct DuckDBWebFFIConnection {
        _private: [u8; 0],
    }

    #[repr(C)]
    struct DuckDBWebFFIResult {
        _private: [u8; 0],
    }

    const DUCKDB_WEB_FFI_STATUS_OK: u32 = 0;
    const DUCKDB_WEB_FFI_RESULT_KIND_BYTES: u32 = 1;
    const DUCKDB_WEB_FFI_RESULT_KIND_STRING: u32 = 2;
    const DUCKDB_WEB_FFI_RESULT_KIND_DATABASE: u32 = 3;
    const DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION: u32 = 4;
    const DUCKDB_WEB_FFI_RESULT_KIND_BOOLEAN: u32 = 6;
    const DUCKDB_WEB_FFI_RESULT_KIND_RETRY: u32 = 7;

    unsafe extern "C" {
        fn duckdb_web_ffi_database_create() -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_database_destroy(database: *mut DuckDBWebFFIDatabase);
        fn duckdb_web_ffi_connection_destroy(connection: *mut DuckDBWebFFIConnection);
        fn duckdb_web_ffi_database_open(
            database: *mut DuckDBWebFFIDatabase,
            args_json: *const std::ffi::c_char,
        ) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_database_reset(database: *mut DuckDBWebFFIDatabase) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_database_get_version(database: *mut DuckDBWebFFIDatabase) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_database_connect(database: *mut DuckDBWebFFIDatabase) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_connection_pending_query_start(
            connection: *mut DuckDBWebFFIConnection,
            script: *const std::ffi::c_char,
            allow_stream_result: bool,
        ) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_connection_pending_query_poll(connection: *mut DuckDBWebFFIConnection) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_connection_pending_query_cancel(connection: *mut DuckDBWebFFIConnection) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_connection_query_fetch_results(connection: *mut DuckDBWebFFIConnection) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_connection_insert_arrow_from_ipc_stream(
            connection: *mut DuckDBWebFFIConnection,
            buffer: *const u8,
            buffer_length: usize,
            options_json: *const std::ffi::c_char,
        ) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_result_destroy(result: *mut DuckDBWebFFIResult);
        fn duckdb_web_ffi_result_status_code(result: *const DuckDBWebFFIResult) -> u32;
        fn duckdb_web_ffi_result_kind(result: *const DuckDBWebFFIResult) -> u32;
        fn duckdb_web_ffi_result_arrow_status_code(result: *const DuckDBWebFFIResult) -> u32;
        fn duckdb_web_ffi_result_error_message(result: *const DuckDBWebFFIResult) -> *const std::ffi::c_char;
        fn duckdb_web_ffi_result_error_message_length(result: *const DuckDBWebFFIResult) -> usize;
        fn duckdb_web_ffi_result_data(result: *const DuckDBWebFFIResult) -> *const u8;
        fn duckdb_web_ffi_result_data_length(result: *const DuckDBWebFFIResult) -> usize;
        fn duckdb_web_ffi_result_string(result: *const DuckDBWebFFIResult) -> *const std::ffi::c_char;
        fn duckdb_web_ffi_result_string_length(result: *const DuckDBWebFFIResult) -> usize;
        fn duckdb_web_ffi_result_database(result: *const DuckDBWebFFIResult) -> *mut DuckDBWebFFIDatabase;
        fn duckdb_web_ffi_result_connection(result: *const DuckDBWebFFIResult) -> *mut DuckDBWebFFIConnection;
        fn duckdb_web_ffi_result_boolean(result: *const DuckDBWebFFIResult) -> bool;
    }

    fn read_bytes(ptr: *const u8, len: usize) -> Vec<u8> {
        if ptr.is_null() || len == 0 {
            return Vec::new();
        }
        unsafe { slice::from_raw_parts(ptr, len) }.to_vec()
    }

    fn read_chars(ptr: *const std::ffi::c_char, len: usize) -> Vec<u8> {
        read_bytes(ptr.cast::<u8>(), len)
    }

    fn read_error(result: *const DuckDBWebFFIResult) -> String {
        let ptr = unsafe { duckdb_web_ffi_result_error_message(result) };
        let len = unsafe { duckdb_web_ffi_result_error_message_length(result) };
        String::from_utf8_lossy(&read_chars(ptr, len)).into_owned()
    }

    fn read_string(result: *const DuckDBWebFFIResult) -> String {
        let ptr = unsafe { duckdb_web_ffi_result_string(result) };
        let len = unsafe { duckdb_web_ffi_result_string_length(result) };
        String::from_utf8_lossy(&read_chars(ptr, len)).into_owned()
    }

    fn expect_status(result: &ResultHandle) -> Result<(), String> {
        if result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(result.error());
        }
        Ok(())
    }

    fn expect_kind(result: &ResultHandle, expected: u32, context: &'static str) -> Result<(), String> {
        if result.kind() != expected {
            return Err(format!(
                "duckdb ffi returned unexpected {} result kind {}",
                context,
                result.kind()
            ));
        }
        Ok(())
    }

    struct ResultHandle(*mut DuckDBWebFFIResult);

    impl ResultHandle {
        fn new(raw: *mut DuckDBWebFFIResult) -> Result<Self, String> {
            if raw.is_null() {
                return Err("duckdb ffi returned a null result handle".to_string());
            }
            Ok(Self(raw))
        }

        fn status_code(&self) -> u32 {
            unsafe { duckdb_web_ffi_result_status_code(self.0) }
        }

        fn kind(&self) -> u32 {
            unsafe { duckdb_web_ffi_result_kind(self.0) }
        }

        fn arrow_status_code(&self) -> u32 {
            unsafe { duckdb_web_ffi_result_arrow_status_code(self.0) }
        }

        fn database(&self) -> *mut DuckDBWebFFIDatabase {
            unsafe { duckdb_web_ffi_result_database(self.0) }
        }

        fn connection(&self) -> *mut DuckDBWebFFIConnection {
            unsafe { duckdb_web_ffi_result_connection(self.0) }
        }

        fn bytes(&self) -> Vec<u8> {
            let ptr = unsafe { duckdb_web_ffi_result_data(self.0) };
            let len = unsafe { duckdb_web_ffi_result_data_length(self.0) };
            read_bytes(ptr, len)
        }

        fn string(&self) -> String {
            read_string(self.0)
        }

        fn error(&self) -> String {
            read_error(self.0)
        }

        fn boolean(&self) -> bool {
            unsafe { duckdb_web_ffi_result_boolean(self.0) }
        }
    }

    impl Drop for ResultHandle {
        fn drop(&mut self) {
            unsafe { duckdb_web_ffi_result_destroy(self.0) };
        }
    }

    pub struct QueryResult {
        pub bytes: Vec<u8>,
        pub arrow_status_code: u32,
    }

    pub enum QueryStreamFetchResult {
        Chunk(QueryResult),
        Retry,
        EndOfStream,
    }

    pub struct DatabaseHandle(*mut DuckDBWebFFIDatabase);

    impl DatabaseHandle {
        fn new(raw: *mut DuckDBWebFFIDatabase) -> Result<Self, String> {
            if raw.is_null() {
                return Err("duckdb ffi returned a null database handle".to_string());
            }
            Ok(Self(raw))
        }

        pub fn create() -> Result<Self, String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_database_create() })?;
            expect_status(&result)?;
            expect_kind(&result, DUCKDB_WEB_FFI_RESULT_KIND_DATABASE, "create")?;
            Self::new(result.database())
        }

        pub fn open(&self, args_json: &str) -> Result<(), String> {
            let args_json = CString::new(args_json)
                .map_err(|_| "duckdb open args contains interior NUL byte".to_string())?;
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_database_open(self.0, args_json.as_ptr()) })?;
            expect_status(&result)
        }

        pub fn reset(&self) -> Result<(), String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_database_reset(self.0) })?;
            expect_status(&result)
        }

        pub fn get_version(&self) -> Result<String, String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_database_get_version(self.0) })?;
            expect_status(&result)?;
            expect_kind(&result, DUCKDB_WEB_FFI_RESULT_KIND_STRING, "version")?;
            Ok(result.string())
        }

        pub fn connect(&self) -> Result<ConnectionHandle, String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_database_connect(self.0) })?;
            expect_status(&result)?;
            expect_kind(&result, DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION, "connect")?;
            ConnectionHandle::new(result.connection())
        }
    }

    impl Drop for DatabaseHandle {
        fn drop(&mut self) {
            unsafe { duckdb_web_ffi_database_destroy(self.0) };
        }
    }

    unsafe impl Send for DatabaseHandle {}

    pub struct ConnectionHandle(*mut DuckDBWebFFIConnection);

    impl ConnectionHandle {
        fn new(raw: *mut DuckDBWebFFIConnection) -> Result<Self, String> {
            if raw.is_null() {
                return Err("duckdb ffi returned a null connection handle".to_string());
            }
            Ok(Self(raw))
        }

        pub fn start_pending_query(&self, sql: &str, allow_stream_result: bool) -> Result<Option<Vec<u8>>, String> {
            let sql = CString::new(sql)
                .map_err(|_| "duckdb query contains interior NUL byte".to_string())?;
            let result = ResultHandle::new(unsafe {
                duckdb_web_ffi_connection_pending_query_start(self.0, sql.as_ptr(), allow_stream_result)
            })?;
            expect_status(&result)?;
            expect_kind(&result, DUCKDB_WEB_FFI_RESULT_KIND_BYTES, "pending query start")?;
            let bytes = result.bytes();
            if bytes.is_empty() {
                Ok(None)
            } else {
                Ok(Some(bytes))
            }
        }

        pub fn poll_pending_query(&self) -> Result<Option<Vec<u8>>, String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_connection_pending_query_poll(self.0) })?;
            expect_status(&result)?;
            expect_kind(&result, DUCKDB_WEB_FFI_RESULT_KIND_BYTES, "pending query poll")?;
            let bytes = result.bytes();
            if bytes.is_empty() {
                Ok(None)
            } else {
                Ok(Some(bytes))
            }
        }

        pub fn cancel_pending_query(&self) -> Result<bool, String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_connection_pending_query_cancel(self.0) })?;
            expect_status(&result)?;
            expect_kind(&result, DUCKDB_WEB_FFI_RESULT_KIND_BOOLEAN, "pending query cancel")?;
            Ok(result.boolean())
        }

        pub fn fetch_query_results(&self) -> Result<QueryStreamFetchResult, String> {
            let result = ResultHandle::new(unsafe { duckdb_web_ffi_connection_query_fetch_results(self.0) })?;
            expect_status(&result)?;
            match result.kind() {
                DUCKDB_WEB_FFI_RESULT_KIND_BYTES => {
                    let bytes = result.bytes();
                    if bytes.is_empty() {
                        Ok(QueryStreamFetchResult::EndOfStream)
                    } else {
                        Ok(QueryStreamFetchResult::Chunk(QueryResult {
                            bytes,
                            arrow_status_code: result.arrow_status_code(),
                        }))
                    }
                }
                DUCKDB_WEB_FFI_RESULT_KIND_RETRY => Ok(QueryStreamFetchResult::Retry),
                other => Err(format!("duckdb ffi returned unexpected fetch result kind {}", other)),
            }
        }

        pub fn insert_arrow_from_ipc_stream(&self, buffer: &[u8], options_json: &str) -> Result<(), String> {
            let options_json = CString::new(options_json)
                .map_err(|_| "duckdb insert options contains interior NUL byte".to_string())?;
            let result = ResultHandle::new(unsafe {
                duckdb_web_ffi_connection_insert_arrow_from_ipc_stream(
                    self.0,
                    buffer.as_ptr(),
                    buffer.len(),
                    options_json.as_ptr(),
                )
            })?;
            expect_status(&result)
        }
    }

    impl Drop for ConnectionHandle {
        fn drop(&mut self) {
            unsafe { duckdb_web_ffi_connection_destroy(self.0) };
        }
    }

    unsafe impl Send for ConnectionHandle {}

    pub fn linked_version() -> Result<Option<String>, String> {
        let database = DatabaseHandle::create()?;
        Ok(Some(database.get_version()?))
    }

    #[cfg(test)]
    pub fn query_returns_rows(sql: &str) -> Result<Option<bool>, String> {
        let database = DatabaseHandle::create()?;
        database.open("")?;
        let connection = database.connect()?;
        let schema = connection.start_pending_query(sql, true)?;
        if let Some(schema) = schema {
            return Ok(Some(!schema.is_empty()));
        }
        for _ in 0..100 {
            if let Some(schema) = connection.poll_pending_query()? {
                return Ok(Some(!schema.is_empty()));
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Ok(None)
    }
}

pub use imp::ConnectionHandle as Connection;
pub use imp::DatabaseHandle as Database;
pub use imp::QueryStreamFetchResult;

pub fn linked_version() -> Result<Option<String>, String> {
    imp::linked_version()
}

#[cfg(test)]
pub fn query_returns_rows(sql: &str) -> Result<Option<bool>, String> {
    imp::query_returns_rows(sql)
}
