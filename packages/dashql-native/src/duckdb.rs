mod imp {
    use std::ffi::CString;
    use std::slice;

    #[repr(C)]
    struct DuckDBWebFFIDatabase {
        _private: [u8; 0],
    }

    #[cfg(test)]
    #[repr(C)]
    struct DuckDBWebFFIConnection {
        _private: [u8; 0],
    }

    #[repr(C)]
    struct DuckDBWebFFIResult {
        _private: [u8; 0],
    }

    const DUCKDB_WEB_FFI_STATUS_OK: u32 = 0;
    #[cfg(test)]
    const DUCKDB_WEB_FFI_RESULT_KIND_BYTES: u32 = 1;
    const DUCKDB_WEB_FFI_RESULT_KIND_DATABASE: u32 = 3;
    const DUCKDB_WEB_FFI_RESULT_KIND_STRING: u32 = 2;
    #[cfg(test)]
    const DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION: u32 = 4;

    unsafe extern "C" {
        fn duckdb_web_ffi_database_create() -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_database_destroy(database: *mut DuckDBWebFFIDatabase);
        #[cfg(test)]
        fn duckdb_web_ffi_connection_destroy(connection: *mut DuckDBWebFFIConnection);
        #[cfg(test)]
        fn duckdb_web_ffi_database_open(database: *mut DuckDBWebFFIDatabase, args_json: *const std::ffi::c_char)
            -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_database_get_version(database: *mut DuckDBWebFFIDatabase) -> *mut DuckDBWebFFIResult;
        #[cfg(test)]
        fn duckdb_web_ffi_database_connect(database: *mut DuckDBWebFFIDatabase) -> *mut DuckDBWebFFIResult;
        #[cfg(test)]
        fn duckdb_web_ffi_connection_query_run(
            connection: *mut DuckDBWebFFIConnection,
            script: *const std::ffi::c_char,
        ) -> *mut DuckDBWebFFIResult;
        fn duckdb_web_ffi_result_destroy(result: *mut DuckDBWebFFIResult);
        fn duckdb_web_ffi_result_status_code(result: *const DuckDBWebFFIResult) -> u32;
        fn duckdb_web_ffi_result_kind(result: *const DuckDBWebFFIResult) -> u32;
        fn duckdb_web_ffi_result_error_message(result: *const DuckDBWebFFIResult) -> *const std::ffi::c_char;
        fn duckdb_web_ffi_result_error_message_length(result: *const DuckDBWebFFIResult) -> usize;
        #[cfg(test)]
        fn duckdb_web_ffi_result_data(result: *const DuckDBWebFFIResult) -> *const u8;
        #[cfg(test)]
        fn duckdb_web_ffi_result_data_length(result: *const DuckDBWebFFIResult) -> usize;
        fn duckdb_web_ffi_result_string(result: *const DuckDBWebFFIResult) -> *const std::ffi::c_char;
        fn duckdb_web_ffi_result_string_length(result: *const DuckDBWebFFIResult) -> usize;
        fn duckdb_web_ffi_result_database(result: *const DuckDBWebFFIResult) -> *mut DuckDBWebFFIDatabase;
        #[cfg(test)]
        fn duckdb_web_ffi_result_connection(result: *const DuckDBWebFFIResult) -> *mut DuckDBWebFFIConnection;
    }

    fn read_bytes(ptr: *const std::ffi::c_char, len: usize) -> Vec<u8> {
        if ptr.is_null() || len == 0 {
            return Vec::new();
        }
        unsafe { slice::from_raw_parts(ptr.cast::<u8>(), len) }.to_vec()
    }

    fn read_error(result: *const DuckDBWebFFIResult) -> String {
        let ptr = unsafe { duckdb_web_ffi_result_error_message(result) };
        let len = unsafe { duckdb_web_ffi_result_error_message_length(result) };
        String::from_utf8_lossy(&read_bytes(ptr, len)).into_owned()
    }

    fn read_string(result: *const DuckDBWebFFIResult) -> String {
        let ptr = unsafe { duckdb_web_ffi_result_string(result) };
        let len = unsafe { duckdb_web_ffi_result_string_length(result) };
        String::from_utf8_lossy(&read_bytes(ptr, len)).into_owned()
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

        fn database(&self) -> *mut DuckDBWebFFIDatabase {
            unsafe { duckdb_web_ffi_result_database(self.0) }
        }

        #[cfg(test)]
        fn connection(&self) -> *mut DuckDBWebFFIConnection {
            unsafe { duckdb_web_ffi_result_connection(self.0) }
        }

        #[cfg(test)]
        fn data_len(&self) -> usize {
            unsafe { duckdb_web_ffi_result_data_length(self.0) }
        }

        fn string(&self) -> String {
            read_string(self.0)
        }

        fn error(&self) -> String {
            read_error(self.0)
        }
    }

    impl Drop for ResultHandle {
        fn drop(&mut self) {
            unsafe { duckdb_web_ffi_result_destroy(self.0) };
        }
    }

    struct DatabaseHandle(*mut DuckDBWebFFIDatabase);

    impl DatabaseHandle {
        fn new(raw: *mut DuckDBWebFFIDatabase) -> Result<Self, String> {
            if raw.is_null() {
                return Err("duckdb ffi returned a null database handle".to_string());
            }
            Ok(Self(raw))
        }
    }

    impl Drop for DatabaseHandle {
        fn drop(&mut self) {
            unsafe { duckdb_web_ffi_database_destroy(self.0) };
        }
    }

    #[cfg(test)]
    struct ConnectionHandle(*mut DuckDBWebFFIConnection);

    #[cfg(test)]
    impl ConnectionHandle {
        fn new(raw: *mut DuckDBWebFFIConnection) -> Result<Self, String> {
            if raw.is_null() {
                return Err("duckdb ffi returned a null connection handle".to_string());
            }
            Ok(Self(raw))
        }
    }

    #[cfg(test)]
    impl Drop for ConnectionHandle {
        fn drop(&mut self) {
            unsafe { duckdb_web_ffi_connection_destroy(self.0) };
        }
    }

    fn create_database() -> Result<DatabaseHandle, String> {
        let create_result = ResultHandle::new(unsafe { duckdb_web_ffi_database_create() })?;
        if create_result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(create_result.error());
        }
        if create_result.kind() != DUCKDB_WEB_FFI_RESULT_KIND_DATABASE {
            return Err(format!(
                "duckdb ffi returned unexpected create result kind {}",
                create_result.kind()
            ));
        }
        DatabaseHandle::new(create_result.database())
    }

    #[cfg(test)]
    fn open_database(database: &DatabaseHandle, args_json: &str) -> Result<(), String> {
        let args_json = CString::new(args_json).map_err(|_| "duckdb open args contains interior NUL byte".to_string())?;
        let open_result = ResultHandle::new(unsafe { duckdb_web_ffi_database_open(database.0, args_json.as_ptr()) })?;
        if open_result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(open_result.error());
        }
        Ok(())
    }

    #[cfg(test)]
    fn connect_database(database: &DatabaseHandle) -> Result<ConnectionHandle, String> {
        let connect_result = ResultHandle::new(unsafe { duckdb_web_ffi_database_connect(database.0) })?;
        if connect_result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(connect_result.error());
        }
        if connect_result.kind() != DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION {
            return Err(format!(
                "duckdb ffi returned unexpected connect result kind {}",
                connect_result.kind()
            ));
        }
        ConnectionHandle::new(connect_result.connection())
    }

    pub fn linked_version() -> Result<Option<String>, String> {
        let create_result = ResultHandle::new(unsafe { duckdb_web_ffi_database_create() })?;
        if create_result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(create_result.error());
        }
        if create_result.kind() != DUCKDB_WEB_FFI_RESULT_KIND_DATABASE {
            return Err(format!(
                "duckdb ffi returned unexpected create result kind {}",
                create_result.kind()
            ));
        }
        let database = DatabaseHandle::new(create_result.database())?;

        let version_result = ResultHandle::new(unsafe { duckdb_web_ffi_database_get_version(database.0) })?;
        if version_result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(version_result.error());
        }
        if version_result.kind() != DUCKDB_WEB_FFI_RESULT_KIND_STRING {
            return Err(format!(
                "duckdb ffi returned unexpected version result kind {}",
                version_result.kind()
            ));
        }
        Ok(Some(version_result.string()))
    }

    #[cfg(test)]
    pub fn query_returns_rows(sql: &str) -> Result<Option<bool>, String> {
        let database = create_database()?;
        open_database(&database, "")?;
        let connection = connect_database(&database)?;
        let sql = CString::new(sql).map_err(|_| "duckdb query contains interior NUL byte".to_string())?;
        let query_result = ResultHandle::new(unsafe { duckdb_web_ffi_connection_query_run(connection.0, sql.as_ptr()) })?;
        if query_result.status_code() != DUCKDB_WEB_FFI_STATUS_OK {
            return Err(query_result.error());
        }
        if query_result.kind() != DUCKDB_WEB_FFI_RESULT_KIND_BYTES {
            return Err(format!(
                "duckdb ffi returned unexpected query result kind {}",
                query_result.kind()
            ));
        }
        Ok(Some(query_result.data_len() > 0))
    }
}

pub fn linked_version() -> Result<Option<String>, String> {
    imp::linked_version()
}

#[cfg(test)]
pub fn query_returns_rows(sql: &str) -> Result<Option<bool>, String> {
    imp::query_returns_rows(sql)
}
