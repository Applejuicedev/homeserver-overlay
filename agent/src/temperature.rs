use std::fs;

/// Liest die CPU-Package-Temperatur über den `coretemp`-Hwmon-Treiber.
/// Gibt None zurueck, wenn kein passender Sensor gefunden wird (z.B. andere CPU-Plattform).
pub fn read_cpu_temp_celsius() -> Option<f32> {
    let entries = fs::read_dir("/sys/class/hwmon").ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = fs::read_to_string(path.join("name")).ok()?;
        if name.trim() != "coretemp" {
            continue;
        }

        for input in ["temp1_input", "temp2_input", "temp3_input"] {
            if let Ok(raw) = fs::read_to_string(path.join(input)) {
                if let Ok(millidegrees) = raw.trim().parse::<f32>() {
                    return Some(millidegrees / 1000.0);
                }
            }
        }
    }
    None
}
