use crate::metrics::Metrics;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

const DB_PATH: &str = "/opt/homeserver-agent/history.sqlite3";
const RETENTION_SECONDS: i64 = 24 * 3600;

pub struct History {
    conn: Mutex<Connection>,
}

#[derive(Serialize)]
pub struct HistoryPoint {
    pub timestamp: i64,
    pub cpu_percent_total: f32,
    pub mem_used_bytes: i64,
    pub mem_total_bytes: i64,
    pub disk_available_bytes: i64,
    pub disk_total_bytes: i64,
}

impl History {
    pub fn open() -> Self {
        let conn = Connection::open(DB_PATH).expect("SQLite-Datei konnte nicht geoeffnet werden");
        conn.execute(
            "CREATE TABLE IF NOT EXISTS history (
                timestamp INTEGER PRIMARY KEY,
                cpu_percent_total REAL NOT NULL,
                mem_used_bytes INTEGER NOT NULL,
                mem_total_bytes INTEGER NOT NULL,
                disk_available_bytes INTEGER NOT NULL,
                disk_total_bytes INTEGER NOT NULL
            )",
            [],
        )
        .expect("Tabelle konnte nicht angelegt werden");
        Self {
            conn: Mutex::new(conn),
        }
    }

    pub fn insert(&self, m: &Metrics) {
        let disk = m.disks.first();
        let (disk_avail, disk_total) = disk
            .map(|d| (d.available_bytes as i64, d.total_bytes as i64))
            .unwrap_or((0, 0));

        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO history
                (timestamp, cpu_percent_total, mem_used_bytes, mem_total_bytes, disk_available_bytes, disk_total_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                m.timestamp as i64,
                m.cpu_percent_total,
                m.mem_used_bytes as i64,
                m.mem_total_bytes as i64,
                disk_avail,
                disk_total,
            ],
        );

        let cutoff = m.timestamp as i64 - RETENTION_SECONDS;
        let _ = conn.execute("DELETE FROM history WHERE timestamp < ?1", [cutoff]);
    }

    pub fn query_since(&self, since_timestamp: i64) -> Vec<HistoryPoint> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT timestamp, cpu_percent_total, mem_used_bytes, mem_total_bytes, disk_available_bytes, disk_total_bytes
             FROM history WHERE timestamp >= ?1 ORDER BY timestamp ASC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt.query_map([since_timestamp], |row| {
            Ok(HistoryPoint {
                timestamp: row.get(0)?,
                cpu_percent_total: row.get(1)?,
                mem_used_bytes: row.get(2)?,
                mem_total_bytes: row.get(3)?,
                disk_available_bytes: row.get(4)?,
                disk_total_bytes: row.get(5)?,
            })
        });

        match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => vec![],
        }
    }
}
