use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Command;

#[derive(Serialize, Clone, Default)]
pub struct ContainerInfo {
    pub name: String,
    pub state: String,
    pub status: String,
    pub cpu_percent: f32,
    pub mem_usage: String,
}

pub fn collect_containers() -> Vec<ContainerInfo> {
    let ps_output = match Command::new("docker")
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => return vec![],
    };

    let stats_output = Command::new("docker")
        .args(["stats", "--no-stream", "--format", "{{json .}}"])
        .output()
        .ok()
        .map(|o| o.stdout)
        .unwrap_or_default();

    let mut stats_by_id: HashMap<String, (f32, String)> = HashMap::new();
    for line in String::from_utf8_lossy(&stats_output).lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v.get("ID").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let cpu = v
                .get("CPUPerc")
                .and_then(|x| x.as_str())
                .map(|s| s.trim_end_matches('%').parse::<f32>().unwrap_or(0.0))
                .unwrap_or(0.0);
            let mem = v
                .get("MemUsage")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            stats_by_id.insert(id, (cpu, mem));
        }
    }

    let mut result = vec![];
    for line in String::from_utf8_lossy(&ps_output).lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v.get("ID").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let name = v
                .get("Names")
                .and_then(|x| x.as_str())
                .unwrap_or("?")
                .to_string();
            let state = v
                .get("State")
                .and_then(|x| x.as_str())
                .unwrap_or("?")
                .to_string();
            let status = v
                .get("Status")
                .and_then(|x| x.as_str())
                .unwrap_or("?")
                .to_string();
            let (cpu, mem) = stats_by_id.get(&id).cloned().unwrap_or_default();
            result.push(ContainerInfo {
                name,
                state,
                status,
                cpu_percent: cpu,
                mem_usage: mem,
            });
        }
    }
    result
}
