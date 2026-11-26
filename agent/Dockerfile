FROM rust:1.84-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io smartmontools ca-certificates sudo \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/target/release/homeserver-agent /app/homeserver-agent
ENV AGENT_BIND=0.0.0.0:9090
EXPOSE 9090
ENTRYPOINT ["/app/homeserver-agent"]
