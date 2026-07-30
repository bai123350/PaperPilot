use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};

const LETPUB_SEARCH_URL: &str =
    "https://www.letpub.com.cn/index.php?page=journalapp&view=search&searchissn=";
const REQUEST_INTERVAL: Duration = Duration::from_millis(800);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalMetric {
    pub journal: String,
    pub issn: String,
    pub impact_factor: f32,
    pub source: String,
    pub source_url: String,
    pub data_year: u16,
    pub retrieved_at: DateTime<Utc>,
}

pub struct ImpactFactorLookup {
    agent: ureq::Agent,
    cache_path: PathBuf,
    cache: Mutex<BTreeMap<String, JournalMetric>>,
    last_request: Mutex<Option<Instant>>,
    unavailable: Mutex<bool>,
}

impl ImpactFactorLookup {
    pub fn open(data_dir: &Path) -> Self {
        let cache_path = data_dir.join("impact-factors-letpub.json");
        let cache = fs::read_to_string(&cache_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default();
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(12)))
            .build()
            .into();
        Self {
            agent,
            cache_path,
            cache: Mutex::new(cache),
            last_request: Mutex::new(None),
            unavailable: Mutex::new(false),
        }
    }

    pub fn lookup(&self, journal: Option<&str>, issn: Option<&str>) -> Option<JournalMetric> {
        if self.unavailable.lock().is_ok_and(|state| *state) {
            return None;
        }
        let issn = normalize_issn(issn?)?;
        if let Some(cached) = self
            .cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(&issn).cloned())
        {
            return Some(cached);
        }

        self.wait_for_request_slot();
        let source_url = format!("{LETPUB_SEARCH_URL}{issn}");
        let html = match self
            .agent
            .get(&source_url)
            .header("User-Agent", "PaperPilot/0.1 (local journal metric lookup)")
            .call()
            .and_then(|mut response| response.body_mut().read_to_string())
        {
            Ok(html) => html,
            Err(_) => {
                if let Ok(mut state) = self.unavailable.lock() {
                    *state = true;
                }
                return None;
            }
        };
        let metric = parse_letpub_search_result(&html, &issn, journal, &source_url);

        if let (Some(metric), Ok(mut cache)) = (metric.as_ref(), self.cache.lock()) {
            cache.insert(issn, metric.clone());
            if let Some(parent) = self.cache_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(content) = serde_json::to_string_pretty(&*cache) {
                let _ = fs::write(&self.cache_path, content);
            }
        }
        metric
    }

    fn wait_for_request_slot(&self) {
        let Ok(mut last_request) = self.last_request.lock() else {
            return;
        };
        if let Some(previous) = *last_request {
            let elapsed = previous.elapsed();
            if elapsed < REQUEST_INTERVAL {
                std::thread::sleep(REQUEST_INTERVAL - elapsed);
            }
        }
        *last_request = Some(Instant::now());
    }
}

fn normalize_issn(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .to_ascii_uppercase()
        .chars()
        .filter(|character| character.is_ascii_digit() || *character == 'X')
        .collect::<String>();
    if normalized.len() != 8 {
        return None;
    }
    Some(format!("{}-{}", &normalized[..4], &normalized[4..]))
}

fn parse_letpub_search_result(
    html: &str,
    issn: &str,
    fallback_journal: Option<&str>,
    source_url: &str,
) -> Option<JournalMetric> {
    let issn_index = html.find(&format!(">{issn}</td>"))?;
    let row_start = html[..issn_index].rfind("<tr")?;
    let row_end = html[issn_index..].find("</tr>")? + issn_index + "</tr>".len();
    let row = &html[row_start..row_end];

    let impact_index = row.find("IF:")? + 3;
    let impact_factor = row[impact_index..]
        .trim_start()
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>()
        .parse::<f32>()
        .ok()?;

    let journal = row
        .find("journalid=")
        .and_then(|index| row[index..].find('>').map(|offset| index + offset + 1))
        .and_then(|start| {
            row[start..]
                .find("</a>")
                .map(|offset| decode_html_text(&row[start..start + offset]))
        })
        .filter(|value| !value.is_empty())
        .or_else(|| fallback_journal.map(str::to_owned))
        .unwrap_or_default();

    Some(JournalMetric {
        journal,
        issn: issn.into(),
        impact_factor,
        source: "LetPub（参考值）".into(),
        source_url: source_url.into(),
        data_year: parse_data_year(html)
            .unwrap_or_else(|| Utc::now().year().clamp(0, u16::MAX as i32) as u16),
        retrieved_at: Utc::now(),
    })
}

fn parse_data_year(html: &str) -> Option<u16> {
    let marker = "年最新影响因子数据已更新";
    let marker_index = html.find(marker)?;
    let prefix = &html[..marker_index];
    let year = prefix.chars().rev().take(4).collect::<String>();
    year.chars().rev().collect::<String>().parse().ok()
}

fn decode_html_text(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::{normalize_issn, parse_letpub_search_result};

    #[test]
    fn normalizes_print_and_electronic_issn_values() {
        assert_eq!(normalize_issn("0028-0836").as_deref(), Some("0028-0836"));
        assert_eq!(normalize_issn("1234567X").as_deref(), Some("1234-567X"));
        assert_eq!(normalize_issn("invalid"), None);
    }

    #[test]
    fn parses_the_matching_letpub_result_row() {
        let html = r#"
            <p>2026年最新影响因子数据已更新</p><table>
              <tr><td>0028-0836</td><td><a href="./index.php?journalid=6054&page=journalapp&view=detail">NATURE</a></td>
              <td>9.3</td><td>IF: 56.1<br><br>h-index: 1096</td></tr>
            </table>
        "#;
        let metric = parse_letpub_search_result(
            html,
            "0028-0836",
            Some("Nature"),
            "https://example.test/searchissn=0028-0836",
        )
        .unwrap();
        assert_eq!(metric.journal, "NATURE");
        assert_eq!(metric.issn, "0028-0836");
        assert_eq!(metric.impact_factor, 56.1);
        assert_eq!(metric.data_year, 2026);
        assert_eq!(metric.source, "LetPub（参考值）");
    }

    #[test]
    fn rejects_pages_without_an_exact_issn_result() {
        assert!(
            parse_letpub_search_result(
                "<html>搜索条件匹配：0条记录</html>",
                "0028-0836",
                None,
                "https://example.test",
            )
            .is_none()
        );
    }
}
