# Homeserver Overlay

Eigenständige Desktop-App (macOS + Windows) mit Server-Agent, die den Zustand eines
Homeservers in Echtzeit als Overlay auf dem Desktop anzeigt: CPU, RAM, Swap, Festplatte,
Docker-Container, SMART-Gesundheit, CPU-Temperatur, Verlaufsgrafiken und Alarme.

## Architektur

```
homeserver-overlay/
├── agent/   Rust-Server-Agent (WebSocket + REST, laeuft auf dem Homeserver)
└── app/     Tauri v2 Desktop-App (React/TypeScript, Overlay-Fenster)
```

- **Agent**: sammelt Metriken via [`sysinfo`], Docker (`docker ps`/`docker stats`),
  SMART (`smartctl`) und CPU-Temperatur (`/sys/class/hwmon`). Streamt sie per WebSocket
  (1×/Sekunde) an verbundene Clients und haelt eine 24h-Historie in SQLite fuer Sparklines.
  Zugriff ist durch ein beim ersten Start generiertes Token geschuetzt.
- **App**: verbindet sich per WebSocket zum Agent, zeigt ein kompaktes immer-oben-Widget
  (frei verschiebbar, Klick-durch per Hotkey) oder ein ausklappbares Dashboard mit
  Verlaufsgrafiken, Container-Liste und Alarmen. Tray-Icon (macOS Menueleiste /
  Windows Taskleiste) mit Status-Punkt.

## 1. Agent auf dem Homeserver installieren

Voraussetzungen: Ubuntu/Debian-artiges Linux, `docker`, optional `smartmontools`.

```bash
# Rust-Toolchain (falls noch nicht vorhanden)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
sudo apt install -y build-essential pkg-config libssl-dev smartmontools

git clone https://github.com/Applejuicedev/homeserver-overlay.git
cd homeserver-overlay/agent
cargo build --release

sudo mkdir -p /opt/homeserver-agent
sudo cp target/release/homeserver-agent /opt/homeserver-agent/
sudo chown $USER:$USER /opt/homeserver-agent
sudo cp systemd/homeserver-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homeserver-agent
```

Das Auth-Token wird beim ersten Start automatisch generiert und unter
`/opt/homeserver-agent/token` abgelegt:

```bash
cat /opt/homeserver-agent/token
```

**Docker-Zugriff**: Der Dienst muss als Benutzer in der `docker`-Gruppe laufen
(`sudo usermod -aG docker <user>`), damit `docker ps`/`docker stats` ohne `sudo`
funktionieren.

**SMART-Zugriff**: `smartctl` benoetigt Root-Rechte. Der Agent ruft es per `sudo`
auf - der Service-User braucht dafuer eine passwortlose Sudo-Regel fuer `smartctl`
(oder, einfacher/wenn vertretbar, allgemeine passwortlose Sudo-Rechte). Die
systemd-Unit darf dabei **kein** `NoNewPrivileges=true` setzen, da das `sudo`
komplett blockiert.

### Alternativ: Docker-Image

```bash
docker run -d --name homeserver-agent \
  --restart unless-stopped \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v homeserver-agent-data:/opt/homeserver-agent \
  --privileged \
  ghcr.io/applejuicedev/homeserver-overlay/agent:latest
```

(`--privileged` wird fuer SMART-Zugriff auf die Hostplatten benoetigt.)

## 2. App auf Mac/Windows installieren

Fertige Installer liegen unter den [GitHub Releases](https://github.com/Applejuicedev/homeserver-overlay/releases)
(sobald ein `app-v*`-Tag gepusht wurde):

- **macOS**: `.dmg` (Universal, Apple Silicon + Intel)
- **Windows**: `.msi` / `.exe`

### Unsignierte Builds oeffnen

Ohne Apple-Developer- bzw. Windows-Code-Signing-Zertifikat (siehe unten) warnen
die Betriebssysteme beim ersten Start:

- **macOS (Gatekeeper)**: Rechtsklick auf die App → **Öffnen** (statt Doppelklick) →
  im Dialog nochmal **Öffnen** bestaetigen. Falls das nicht reicht:
  `xattr -cr "/Applications/Homeserver Overlay.app"` im Terminal.
- **Windows (SmartScreen)**: Im Warn-Dialog auf **Weitere Informationen** klicken,
  dann **Trotzdem ausfuehren**.

## 3. Konfiguration

Beim ersten Start der App (oder über das Zahnrad-Icon):

1. **Server-URL**: `http://<tailscale-ip-oder-hostname>:9090`
2. **Token**: Inhalt von `/opt/homeserver-agent/token` auf dem Server

Weitere Einstellungen im Panel: Theme (Auto/Dunkel/Hell), Deckkraft, sichtbare
Widgets, Alarm-Schwellwerte (CPU-Temperatur, Speicherbelegung).

**Hotkey**: `Strg+Alt+H` (bzw. `Cmd+Alt+H` auf macOS) schaltet den Klick-durch-Modus
um - die Maus "fasst durch" das Overlay, nur ueber Tray-Icon oder Hotkey wieder
bedienbar.

## 4. Fehlerbehebung

| Problem | Lösung |
|---|---|
| Overlay zeigt "Keine Verbindung" | Server-URL/Token prüfen, Agent-Dienst läuft? (`systemctl status homeserver-agent`), Firewall/Tailscale-Verbindung prüfen |
| Keine SMART-Daten | `smartmontools` installiert? Sudo-Regel fuer den Service-User vorhanden? `NoNewPrivileges` in der systemd-Unit entfernt? |
| Keine CPU-Temperatur | Nicht jede Hardware stellt `coretemp` über `/sys/class/hwmon` bereit - das Feld bleibt dann `null`, kein Fehler |
| Keine Docker-Container gelistet | Service-User in der `docker`-Gruppe? |
| App startet nicht (Windows) | SmartScreen-Warnung bestätigen (siehe oben) oder Code-Signing einrichten |
| App startet nicht (macOS) | Gatekeeper-Hinweis oben befolgen |
| Update wird nicht angeboten | Nur bei getaggten Releases (`app-v*`) mit korrekt gesetztem `TAURI_SIGNING_PRIVATE_KEY`-Secret verfuegbar |

## 5. Entwicklung

```bash
# Agent
cd agent && cargo run

# App (Hot-Reload)
cd app && npm install && npm run tauri dev
```

### Release erstellen

```bash
git tag app-v0.1.0 && git push origin app-v0.1.0     # App-Build + GitHub Release (Draft)
git tag agent-v0.1.0 && git push origin agent-v0.1.0 # Agent-Binaries + Docker-Image
```

### Auto-Updater

Die App prüft bei jedem Start `https://github.com/Applejuicedev/homeserver-overlay/releases/latest/download/latest.json`
auf neue Versionen. Updates sind mit einem Minisign-Schlüsselpaar signiert; der
private Schlüssel liegt **nicht** im Repo, sondern als GitHub-Secrets
(`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

### Code-Signing einrichten (optional)

Aktuell sind die Builds **unsigniert** (siehe Gatekeeper/SmartScreen-Hinweise oben).
Um das zu ändern:

**macOS** (Apple Developer Account, 99 USD/Jahr):
1. Zertifikat als `.p12` exportieren, Base64-kodieren
2. GitHub-Secrets setzen: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (App-spezifisches Passwort),
   `APPLE_TEAM_ID`
3. In `.github/workflows/build-app.yml` die entsprechenden auskommentierten
   `env`-Zeilen aktivieren

**Windows** (Code-Signing-Zertifikat, z.B. von DigiCert/Sectigo):
1. Zertifikat als `.pfx` exportieren, Base64-kodieren
2. GitHub-Secrets setzen: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`
3. Entsprechende Zeilen in `build-app.yml` aktivieren

## Qualitätsziele

- Ziel-Ressourcenverbrauch: < 100 MB RAM, nahe 0% CPU im Leerlauf
- Auto-Reconnect mit exponentiellem Backoff (1s → 30s) bei Verbindungsabbruch
- Keine Zugangsdaten im Klartext im Repo - der Agent-Token liegt clientseitig im
  OS-Schlüsselbund (macOS Keychain / Windows Credential Manager, via `keyring`-Crate),
  nicht in `localStorage`
