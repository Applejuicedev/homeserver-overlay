use crate::docker::ContainerInfo;
use crate::smart::SmartInfo;
use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Serialize, Clone)]
pub struct Metrics {
    pub timestamp: u64,
    pub hostname: String,
    pub cpu_percent_total: f32,
    pub cpu_percent_per_core: Vec<f32>,
    pub load_avg: [f64; 3],
    pub mem_total_bytes: u64,
    pub mem_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub disks: Vec<DiskInfo>,
    pub uptime_seconds: u64,
    #[serde(default)]
    pub containers: Vec<ContainerInfo>,
    #[serde(default)]
    pub smart: Vec<SmartInfo>,
}

#[derive(Serialize, Clone)]
pub struct DiskInfo {
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

pub struct Collector {
    sys: System,
    disks: Disks,
}

impl Collector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self {
            sys,
            disks: Disks::new_with_refreshed_list(),
        }
    }

    pub fn collect(&mut self) -> Metrics {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.disks.refresh();

        let load = System::load_average();
        let cpus = self.sys.cpus();
        let cpu_percent_per_core: Vec<f32> = cpus.iter().map(|c| c.cpu_usage()).collect();
        let cpu_percent_total = if cpu_percent_per_core.is_empty() {
            0.0
        } else {
            cpu_percent_per_core.iter().sum::<f32>() / cpu_percent_per_core.len() as f32
        };

        let disks: Vec<DiskInfo> = self
            .disks
            .iter()
            .filter(|d| d.mount_point().to_str() == Some("/"))
            .map(|d| DiskInfo {
                mount_point: d.mount_point().to_string_lossy().to_string(),
                total_bytes: d.total_space(),
                available_bytes: d.available_space(),
            })
            .collect();

        Metrics {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            hostname: sysinfo::System::host_name().unwrap_or_else(|| "unknown".into()),
            cpu_percent_total,
            cpu_percent_per_core,
            load_avg: [load.one, load.five, load.fifteen],
            mem_total_bytes: self.sys.total_memory(),
            mem_used_bytes: self.sys.used_memory(),
            swap_total_bytes: self.sys.total_swap(),
            swap_used_bytes: self.sys.used_swap(),
            disks,
            uptime_seconds: System::uptime(),
            containers: vec![],
            smart: vec![],
        }
    }
}
