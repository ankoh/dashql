use neon::prelude::*;
use std::sync::mpsc;
use std::thread;

struct Database {
    inner: duckdbx::Database,
}
struct Connection {
    tx: mpsc::Sender<ConnectionMessage>,
}
struct Buffer {
    inner: duckdbx::Buffer,
}

impl Finalize for Database {}
impl Finalize for Connection {}
impl Finalize for Buffer {}

type ConnectionCallback = Box<dyn FnOnce(&mut duckdbx::Connection, &Channel) + Send>;
enum ConnectionMessage {
    Callback(ConnectionCallback),
    Close,
}

impl Database {
    pub fn close(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let db = cx.this().downcast_or_throw::<JsBox<Database>, _>(&mut cx)?;
        db.inner.close();
        Ok(cx.undefined())
    }
    pub fn open_in_memory(mut cx: FunctionContext) -> JsResult<JsBox<Database>> {
        let db = duckdbx::Database::open_in_memory().or_else(|e| cx.throw_error(e))?;
        Ok(cx.boxed(Database { inner: db }))
    }
    pub fn open(mut cx: FunctionContext) -> JsResult<JsBox<Database>> {
        let path = cx.argument::<JsString>(0)?.value(&mut cx);
        let db = duckdbx::Database::open(&path).or_else(|e| cx.throw_error(e))?;
        Ok(cx.boxed(Database { inner: db }))
    }
    pub fn connect(mut cx: FunctionContext) -> JsResult<JsBox<Connection>> {
        let db = cx.this().downcast_or_throw::<JsBox<Database>, _>(&mut cx)?;
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
        let conn = cx.this().downcast_or_throw::<JsBox<Connection>, _>(&mut cx)?;
        conn.tx
            .send(ConnectionMessage::Close)
            .or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.undefined())
    }
    pub fn run_query(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let conn = cx.this().downcast_or_throw::<JsBox<Connection>, _>(&mut cx)?;
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
        let buffer = cx.this().downcast_or_throw::<JsBox<Buffer>, _>(&mut cx)?;
        buffer.inner.close();
        Ok(cx.undefined())
    }
    pub fn access(mut cx: FunctionContext) -> JsResult<JsArrayBuffer> {
        let buffer = cx.this().downcast_or_throw::<JsBox<Buffer>, _>(&mut cx)?;
        let data = unsafe { std::mem::transmute::<&mut [u8], &'static mut [u8]>(buffer.inner.access()) };
        Ok(JsArrayBuffer::external(&mut cx, data))
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("openInMemory", Database::open_in_memory)?;
    cx.export_function("open", Database::open)?;
    cx.export_function("closeDatabase", Database::close)?;
    cx.export_function("connect", Database::connect)?;
    cx.export_function("closeConnection", Connection::close)?;
    cx.export_function("runQuery", Connection::run_query)?;
    cx.export_function("accessBuffer", Buffer::access)?;
    cx.export_function("deleteBuffer", Buffer::delete)?;
    Ok(())
}
