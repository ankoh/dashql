use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::Full;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tauri::{AppHandle, Emitter};

const OAUTH_CALLBACK_PORT: u16 = 56512;
const OAUTH_CALLBACK_PATH: &str = "/Callback";
const NATIVE_EVENT_CHANNEL: &str = "dashql:oauth-callback";

/// The result of an OAuth callback
#[derive(Debug, Clone)]
pub struct OAuthCallbackResult {
    /// The authorization code (if successful)
    pub code: Option<String>,
    /// The state parameter
    pub state: Option<String>,
    /// The error (if any)
    pub error: Option<String>,
    /// The error description (if any)
    pub error_description: Option<String>,
}

/// HTML response for successful OAuth callback
fn success_html() -> String {
    r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Authentication Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #eee;
        }
        .container {
            text-align: center;
            padding: 2rem;
        }
        .checkmark {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #10b981;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
            animation: scale-in 0.3s ease-out;
        }
        .checkmark svg {
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
        }
        h1 {
            margin: 0 0 0.5rem;
            font-size: 1.5rem;
            font-weight: 600;
        }
        p {
            margin: 0;
            opacity: 0.7;
            font-size: 0.95rem;
        }
        @keyframes scale-in {
            from { transform: scale(0); }
            to { transform: scale(1); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <h1>Authentication Successful</h1>
        <p>You can close this window and return to DashQL.</p>
    </div>
</body>
</html>"#.to_string()
}

/// HTML response for failed OAuth callback
fn error_html(error: &str, description: Option<&str>) -> String {
    let desc = description.unwrap_or("An error occurred during authentication.");
    format!(r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Authentication Failed</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #eee;
        }}
        .container {{
            text-align: center;
            padding: 2rem;
            max-width: 400px;
        }}
        .error-icon {{
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #ef4444;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
        }}
        .error-icon svg {{
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
        }}
        h1 {{
            margin: 0 0 0.5rem;
            font-size: 1.5rem;
            font-weight: 600;
        }}
        p {{
            margin: 0 0 0.5rem;
            opacity: 0.7;
            font-size: 0.95rem;
        }}
        .error-code {{
            font-family: monospace;
            background: rgba(255,255,255,0.1);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.85rem;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <h1>Authentication Failed</h1>
        <p>{desc}</p>
        <p class="error-code">{error}</p>
    </div>
</body>
</html>"#)
}

/// Handle an incoming OAuth callback request
async fn handle_oauth_callback(
    req: Request<hyper::body::Incoming>,
    app_handle: Arc<AppHandle>,
    shutdown_tx: Arc<tokio::sync::Mutex<Option<oneshot::Sender<()>>>>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = req.uri().path();

    // Only handle the callback path
    if path != OAUTH_CALLBACK_PATH && path != "/callback" {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::new(Bytes::from("Not Found")))
            .unwrap());
    }

    // Parse query parameters
    let query = req.uri().query().unwrap_or("");
    let params: std::collections::HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    let code = params.get("code").cloned();
    let state = params.get("state").cloned();
    let error = params.get("error").cloned();
    let error_description = params.get("error_description").cloned();

    log::info!("OAuth callback received: code={}, state={}, error={:?}", 
        code.is_some(), state.is_some(), error);

    let result = OAuthCallbackResult {
        code: code.clone(),
        state: state.clone(),
        error: error.clone(),
        error_description: error_description.clone(),
    };

    // Emit the result to the frontend
    if let Err(e) = app_handle.emit(NATIVE_EVENT_CHANNEL, serde_json::json!({
        "code": result.code,
        "state": result.state,
        "error": result.error,
        "error_description": result.error_description,
    })) {
        log::error!("Failed to emit OAuth callback event: {}", e);
    }

    // Build the response HTML
    let (status, html) = if error.is_some() {
        (StatusCode::OK, error_html(
            error.as_deref().unwrap_or("unknown_error"),
            error_description.as_deref()
        ))
    } else if code.is_some() {
        (StatusCode::OK, success_html())
    } else {
        (StatusCode::BAD_REQUEST, error_html("missing_code", Some("No authorization code was provided.")))
    };

    // Signal shutdown after a small delay to ensure the response is sent
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        if let Some(tx) = shutdown_tx_clone.lock().await.take() {
            let _ = tx.send(());
        }
    });

    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "text/html; charset=utf-8")
        .body(Full::new(Bytes::from(html)))
        .unwrap())
}

/// Start the OAuth callback server
/// Returns a handle that can be used to stop the server
#[allow(dead_code)]
pub struct OAuthCallbackServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl OAuthCallbackServer {
    /// Start a new OAuth callback server
    pub async fn start(app_handle: AppHandle) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let addr = SocketAddr::from(([127, 0, 0, 1], OAUTH_CALLBACK_PORT));

        let listener = TcpListener::bind(addr).await?;
        log::info!("OAuth callback server listening on http://{}", addr);

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let shutdown_tx_shared = Arc::new(tokio::sync::Mutex::new(Some(shutdown_tx)));
        let app_handle = Arc::new(app_handle);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, _)) => {
                                let io = TokioIo::new(stream);
                                let app_handle = app_handle.clone();
                                let shutdown_tx = shutdown_tx_shared.clone();

                                tokio::spawn(async move {
                                    let service = service_fn(move |req| {
                                        handle_oauth_callback(req, app_handle.clone(), shutdown_tx.clone())
                                    });

                                    if let Err(e) = http1::Builder::new()
                                        .serve_connection(io, service)
                                        .await
                                    {
                                        log::error!("Error serving OAuth callback connection: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                log::error!("Error accepting OAuth callback connection: {}", e);
                            }
                        }
                    }
                    _ = &mut shutdown_rx => {
                        log::info!("OAuth callback server shutting down");
                        break;
                    }
                }
            }
        });

        // We don't store the shutdown_tx since the server will auto-shutdown after receiving the callback
        Ok(Self { shutdown_tx: None })
    }

    /// Stop the OAuth callback server (for future use)
    #[allow(dead_code)]
    pub fn stop(self) {
        if let Some(tx) = self.shutdown_tx {
            let _ = tx.send(());
        }
    }
}

/// Global state for the OAuth callback server
use once_cell::sync::Lazy;
use tokio::sync::Mutex;

static OAUTH_SERVER: Lazy<Mutex<Option<()>>> = Lazy::new(|| Mutex::new(None));

/// Start the OAuth callback server (called from Tauri command)
#[tauri::command]
pub async fn start_oauth_callback_server(app_handle: AppHandle) -> Result<(), String> {
    let mut guard = OAUTH_SERVER.lock().await;

    // Check if server is already running by trying to bind
    match OAuthCallbackServer::start(app_handle).await {
        Ok(_server) => {
            *guard = Some(());
            Ok(())
        }
        Err(e) => {
            // If the error is "address already in use", the server might already be running
            let err_str = e.to_string();
            if err_str.contains("address already in use") || err_str.contains("Address already in use") {
                log::warn!("OAuth callback server already running or port in use");
                Ok(())
            } else {
                Err(format!("Failed to start OAuth callback server: {}", e))
            }
        }
    }
}

