mod metrics;

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::State,
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tracing::{info, warn};

use metrics::Collector;

#[derive(Clone)]
struct AppState {
    collector: Arc<Mutex<Collector>>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let bind_addr = std::env::var("AGENT_BIND").unwrap_or_else(|_| "0.0.0.0:9090".to_string());

    let state = AppState {
        collector: Arc::new(Mutex::new(Collector::new())),
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr: SocketAddr = bind_addr.parse().expect("ungueltige AGENT_BIND Adresse");
    info!("homeserver-agent lauscht auf {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    info!("Client verbunden");
    let (mut sender, mut receiver) = socket.split();

    // Client-Nachrichten verwerfen, aber Verbindung auf Trennung ueberwachen
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if msg.is_err() {
                break;
            }
        }
    });

    let send_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            let snapshot = {
                let mut c = state.collector.lock().unwrap();
                c.collect()
            };
            let json = match serde_json::to_string(&snapshot) {
                Ok(j) => j,
                Err(e) => {
                    warn!("Serialisierung fehlgeschlagen: {e}");
                    continue;
                }
            };
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }
    info!("Client getrennt");
}
