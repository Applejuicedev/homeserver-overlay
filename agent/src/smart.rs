use serde::Serialize;
use serde_json::Value;
use std::process::Command;

#[derive(Serialize, Clone)]
pub struct SmartInfo {
    pub device: String,
    pub health_ok: bool,
    pub temperature_celsius: Option<i64>,
}

pub fn detect_disks() -> Vec<String> {
    let output = match Command::new("lsblk")
        .args(["-d", "-n", "-o", "NAME,TYPE"])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => return vec![],
    };

    String::from_utf8_lossy(&output)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?;
            let kind = parts.next()?;
            if kind == "disk" {
                Some(format!("/dev/{name}"))
            } else {
                None
            }
        })
        .collect()
}

pub fn collect_smart(devices: &[String]) -> Vec<SmartInfo> {
    devices
        .iter()
        .filter_map(|dev| {
            let output = Command::new("sudo")
                .args(["smartctl", "-H", "-A", "-j", dev])
                .output()
                .ok()?;
            let v: Value = serde_json::from_slice(&output.stdout).ok()?;
            let health_ok = v
                .get("smart_status")
                .and_then(|s| s.get("passed"))
                .and_then(|p| p.as_bool())
                .unwrap_or(false);
            let temp = v
                .get("temperature")
                .and_then(|t| t.get("current"))
                .and_then(|c| c.as_i64());
            Some(SmartInfo {
                device: dev.clone(),
                health_ok,
                temperature_celsius: temp,
            })
        })
        .collect()
}
