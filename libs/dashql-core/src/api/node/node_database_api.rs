use neon::prelude::*;
use std::sync::mpsc;
use std::thread;

struct Database {
    inner: duckdbx_sys::Database,
}
struct Connection {
    tx: mpsc::Sender<ConnectionMessage>,
}
struct Buffer {
    inner: duckdbx_sys::Buffer,
}

impl Finalize for Database {}
impl Finalize for Connection {}
impl Finalize for Buffer {}

type ConnectionCallback = Box<dyn FnOnce(&mut duckdbx_sys::Connection, &Channel) + Send>;
enum ConnectionMessage {
    Callback(ConnectionCallback),
    Close,
}

impl Database {
    pub fn close(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let db = cx.argument::<JsBox<Database>>(0)?;
        drop(db);
        Ok(cx.undefined())
    }
    pub fn open_in_memory(mut cx: FunctionContext) -> JsResult<JsBox<Database>> {
        let db = duckdbx_sys::Database::open_in_memory().or_else(|e| cx.throw_error(e))?;
        Ok(cx.boxed(Database { inner: db }))
    }
    pub fn open(mut cx: FunctionContext) -> JsResult<JsBox<Database>> {
        let path = cx.argument::<JsString>(0)?.value(&mut cx);
        let db = duckdbx_sys::Database::open(&path).or_else(|e| cx.throw_error(e))?;
        Ok(cx.boxed(Database { inner: db }))
    }
    pub fn connect(mut cx: FunctionContext) -> JsResult<JsBox<Connection>> {
        let db = cx.argument::<JsBox<Database>>(0)?;
        let mut conn = db.inner.connect().or_else(|e| cx.throw_error(e))?;
        let (tx, rx) = mpsc::channel::<ConnectionMessage>();
        let channel = cx.channel();
        thread::spawn(move || {
            while let Ok(message) = rx.recv() {
                match message {
                    ConnectionMessage::Callback(f) => f(&mut conn, &channel),
                    ConnectionMessage::Close => break,
                }
            }
        });
        Ok(cx.boxed(Connection { tx }))
    }
}

impl Connection {
    pub fn close(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let conn = cx.argument::<JsBox<Connection>>(0)?;
        conn.tx
            .send(ConnectionMessage::Close)
            .or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.undefined())
    }
    pub fn run_query(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let conn = cx.argument::<JsBox<Connection>>(0)?;
        let script = cx.argument::<JsString>(1)?.value(&mut cx);
        let on_success = cx.argument::<JsFunction>(2)?.root(&mut cx);
        let on_error = cx.argument::<JsFunction>(3)?.root(&mut cx);
        let callback: ConnectionCallback = Box::new(move |conn, channel| match conn.run_query(&script) {
            Ok(res) => {
                channel.send(move |mut cx| {
                    let on_success = on_success.into_inner(&mut cx);
                    let this = cx.undefined();
                    let args = vec![cx.boxed(Buffer { inner: res }).upcast()];
                    on_success.call(&mut cx, this, args)?;
                    Ok(())
                });
            }
            Err(e) => {
                channel.send(move |mut cx| {
                    let on_error = on_error.into_inner(&mut cx);
                    let this = cx.undefined();
                    let args = vec![cx.error(e.to_string())?.upcast()];
                    on_error.call(&mut cx, this, args)?;
                    Ok(())
                });
            }
        });
        conn.tx
            .send(ConnectionMessage::Callback(callback))
            .or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.undefined())
    }
}

impl Buffer {
    pub fn delete(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let buffer = cx.argument::<JsBox<Buffer>>(0)?;
        drop(buffer);
        Ok(cx.undefined())
    }
    pub fn access(mut cx: FunctionContext) -> JsResult<JsArrayBuffer> {
        let buffer = cx
            .argument::<JsValue>(0)?
            .downcast_or_throw::<JsBox<Buffer>, _>(&mut cx)?;
        let data = unsafe { std::mem::transmute::<&mut [u8], &'static mut [u8]>(buffer.inner.access()) };
        Ok(JsArrayBuffer::external(&mut cx, data))
    }
}

pub fn export_database_api(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("database_open_in_memory", Database::open_in_memory)?;
    cx.export_function("database_open", Database::open)?;
    cx.export_function("database_close", Database::close)?;
    cx.export_function("database_connection_create", Database::connect)?;
    cx.export_function("database_connection_close", Connection::close)?;
    cx.export_function("database_run_query", Connection::run_query)?;
    cx.export_function("database_buffer_access", Buffer::access)?;
    cx.export_function("database_buffer_delete", Buffer::delete)?;
    Ok(())
}