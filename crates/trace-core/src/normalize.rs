pub fn normalize_path(value: &str, home: Option<&str>, project_root: Option<&str>) -> String {
    let mut result = value.replace("\\\\", "/");
    if let Some(root) = project_root.filter(|root| !root.is_empty()) {
        if result == root {
            result = "$PROJECT".into();
        } else if result.starts_with(&format!("{root}/")) {
            result = result.replacen(root, "$PROJECT", 1);
        }
    }
    if let Some(home) = home.filter(|home| !home.is_empty()) {
        if result == home {
            result = "~".into();
        } else if result.starts_with(&format!("{home}/")) {
            result = result.replacen(home, "~", 1);
        }
    }
    normalize_temp_component(&result)
}

fn normalize_temp_component(value: &str) -> String {
    let markers = ["/tmp/", "/var/tmp/", "/dev/shm/"];
    for marker in markers {
        if let Some(index) = value.find(marker) {
            let prefix_end = index + marker.len();
            let remainder = &value[prefix_end..];
            let first = remainder.split('/').next().unwrap_or(remainder);
            let randomized = first.len() >= 8
                && first.chars().filter(|c| c.is_ascii_digit()).count() >= 3
                && first
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
            if randomized {
                return format!(
                    "{}<temp>{}",
                    &value[..prefix_end],
                    &remainder[first.len()..]
                );
            }
        }
    }
    value.to_string()
}

pub fn join_resource(base: &str, resource: &str) -> String {
    if resource.starts_with('/') || resource.starts_with('~') || resource.starts_with('$') {
        return resource.to_string();
    }
    collapse_path(&format!("{}/{}", base.trim_end_matches('/'), resource))
}

fn collapse_path(value: &str) -> String {
    let absolute = value.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in value.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|part| *part != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    format!("{}{}", if absolute { "/" } else { "" }, parts.join("/"))
}

pub fn is_runtime_noise(resource: Option<&str>) -> bool {
    let Some(resource) = resource else {
        return false;
    };
    [
        "/proc/",
        "/sys/",
        "/dev/urandom",
        "/etc/ld.so.cache",
        "/usr/share/locale/",
        "/usr/lib/locale/",
        "/.cache/",
        "__pycache__",
        "/node_modules/.cache/",
    ]
    .iter()
    .any(|needle| resource.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_roots_and_random_temp_names() {
        assert_eq!(
            normalize_path(
                "/home/alex/project/a",
                Some("/home/alex"),
                Some("/home/alex/project")
            ),
            "$PROJECT/a"
        );
        assert_eq!(
            normalize_path("/tmp/build-12345678/file", None, None),
            "/tmp/<temp>/file"
        );
    }

    #[test]
    fn resolves_relative_paths() {
        assert_eq!(
            join_resource("/work/app", "../config.json"),
            "/work/config.json"
        );
        assert_eq!(join_resource(".", "config.json"), "config.json");
        assert_eq!(join_resource(".", "../config.json"), "../config.json");
    }
}
