mod auth;
mod docker;
mod history;
mod metrics;
mod smart;

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{info, warn};

use history::History;
use metrics::{Collector, Metrics};

#[derive(Clone)]
struct AppState {
    tx: broadcast::Sender<Metrics>,
    history: Arc<History>,
    token: Arc<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let bind_addr = std::env::var("AGENT_BIND").unwrap_or_else(|_| "0.0.0.0:9090".to_string());
    let token = auth::load_or_create_token();
    info!("Auth-Token bereit (siehe /etc/homeserver-agent/token)");

    let history = Arc::new(History::open());
    let (tx, _rx) = broadcast::channel::<Metrics>(16);

    // Zentraler Collector: sammelt 1x/Sekunde, verteilt an alle Clients + Historie
    {
        let tx = tx.clone();
        let history = history.clone();
        tokio::spawn(async move {
            let mut collector = Collector::new();
            let disks = smart::detect_disks();
            let mut tick: u64 = 0;
            let mut cached_containers: Vec<docker::ContainerInfo> = vec![];
            let mut cached_smart: Vec<smart::SmartInfo> = vec![];
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                let mut snapshot = collector.collect();

                // Docker/SMART sind teurer (Subprozesse) und werden nur alle 5s aktualisiert
                tick += 1;
                if tick % 5 == 0 {
                    cached_containers = docker::collect_containers();
                    cached_smart = smart::collect_smart(&disks);
                    history.insert(&snapshot);
                }
                snapshot.containers = cached_containers.clone();
                snapshot.smart = cached_smart.clone();

                let _ = tx.send(snapshot);
            }
        });
    }

    let state = AppState {
        tx,
        history,
        token: Arc::new(token),
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .route("/api/history", get(history_handler))
        .with_state(state);

    let addr: SocketAddr = bind_addr.parse().expect("ungueltige AGENT_BIND Adresse");
    info!("homeserver-agent lauscht auf {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

fn check_token(params: &HashMap<String, String>, expected: &str) -> bool {
    auth::is_valid(params.get("token").map(|s| s.as_str()), expected)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_token(&params, &state.token) {
        return (StatusCode::UNAUTHORIZED, "ungueltiges Token").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    info!("Client verbunden");
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if msg.is_err() {
                break;
            }
        }
    });

    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(snapshot) => {
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
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }
    info!("Client getrennt");
}

async fn history_handler(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_token(&params, &state.token) {
        return (StatusCode::UNAUTHORIZED, "ungueltiges Token").into_response();
    }

    let minutes: i64 = params
        .get("minutes")
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let since = now - minutes * 60;

    let points = state.history.query_since(since);
    Json(points).into_response()
}
