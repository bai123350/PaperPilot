use std::{collections::HashSet, thread, time::Duration};

use serde_json::Value;
use ureq::Agent;

use crate::contracts::{DatasetModality, PublicDataset, ResearchBrief};

const NCBI_DELAY: Duration = Duration::from_millis(350);
const NCBI_LIMIT_PER_MODALITY: &str = "3";
const ENCODE_LIMIT_PER_ASSAY: &str = "2";

const GEO_QUERIES: [(DatasetModality, &str); 5] = [
    (
        DatasetModality::BulkRna,
        "\"RNA sequencing\" OR \"expression profiling by high throughput sequencing\"",
    ),
    (
        DatasetModality::SingleCell,
        "\"single cell RNA-seq\" OR scRNA-seq OR snRNA-seq OR \"single nucleus RNA-seq\"",
    ),
    (
        DatasetModality::Spatial,
        "\"spatial transcriptomics\" OR \"spatially resolved transcriptomics\" OR Visium",
    ),
    (
        DatasetModality::AtacSeq,
        "ATAC-seq OR \"assay for transposase-accessible chromatin\"",
    ),
    (
        DatasetModality::Genomics,
        "\"whole genome sequencing\" OR \"whole exome sequencing\" OR WGS OR WES",
    ),
];

const ENCODE_ASSAYS: [(DatasetModality, &str); 3] = [
    (DatasetModality::BulkRna, "total RNA-seq"),
    (DatasetModality::BulkRna, "polyA plus RNA-seq"),
    (DatasetModality::AtacSeq, "ATAC-seq"),
];

pub fn search_public_datasets(agent: &Agent, brief: &ResearchBrief) -> Vec<PublicDataset> {
    let mut datasets = search_ncbi_geo(agent, brief);
    datasets.extend(search_encode(agent, brief));
    let mut seen = HashSet::new();
    datasets.retain(|dataset| {
        seen.insert(format!(
            "{}:{}",
            dataset.source.to_lowercase(),
            dataset.accession.to_lowercase()
        ))
    });
    datasets.truncate(30);
    datasets
}

fn search_ncbi_geo(agent: &Agent, brief: &ResearchBrief) -> Vec<PublicDataset> {
    let mut datasets = Vec::new();
    let base_query = research_query(brief);
    for (fallback_modality, modality_query) in GEO_QUERIES {
        let term = format!("({base_query}) AND ({modality_query}) AND gse[ETYP]");
        let Ok(mut response) = agent
            .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
            .query("db", "gds")
            .query("retmode", "json")
            .query("retmax", NCBI_LIMIT_PER_MODALITY)
            .query("tool", "PaperPilot")
            .query("term", &term)
            .call()
        else {
            continue;
        };
        let Ok(search): Result<Value, _> = response.body_mut().read_json() else {
            continue;
        };
        thread::sleep(NCBI_DELAY);
        let ids = search
            .pointer("/esearchresult/idlist")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_default();
        if ids.is_empty() {
            continue;
        }
        let Ok(mut response) = agent
            .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")
            .query("db", "gds")
            .query("retmode", "json")
            .query("tool", "PaperPilot")
            .query("id", &ids.join(","))
            .call()
        else {
            continue;
        };
        let Ok(summary): Result<Value, _> = response.body_mut().read_json() else {
            continue;
        };
        thread::sleep(NCBI_DELAY);
        let Some(result) = summary.get("result") else {
            continue;
        };
        let uids = result
            .get("uids")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str);
        datasets
            .extend(uids.filter_map(|uid| parse_geo_dataset(result.get(uid)?, fallback_modality)));
    }
    datasets
}

fn search_encode(agent: &Agent, brief: &ResearchBrief) -> Vec<PublicDataset> {
    let mut datasets = Vec::new();
    let search_term = brief
        .keywords
        .iter()
        .take(6)
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    let search_term = if search_term.is_empty() {
        brief
            .population
            .as_deref()
            .unwrap_or(brief.question.trim_end_matches(['?', '？']))
    } else {
        &search_term
    };
    for (modality, assay) in ENCODE_ASSAYS {
        let Ok(mut response) = agent
            .get("https://www.encodeproject.org/search/")
            .header("Accept", "application/json")
            .query("type", "Experiment")
            .query("assay_title", assay)
            .query("status", "released")
            .query("searchTerm", search_term)
            .query("format", "json")
            .query("limit", ENCODE_LIMIT_PER_ASSAY)
            .call()
        else {
            continue;
        };
        let Ok(payload): Result<Value, _> = response.body_mut().read_json() else {
            continue;
        };
        let records = payload
            .get("@graph")
            .and_then(Value::as_array)
            .into_iter()
            .flatten();
        datasets.extend(records.filter_map(|record| parse_encode_dataset(record, modality, assay)));
    }
    datasets
}

fn parse_geo_dataset(record: &Value, fallback: DatasetModality) -> Option<PublicDataset> {
    let accession = text(record, "accession")?;
    let title = text(record, "title")?;
    let summary = text(record, "summary").unwrap_or_default();
    let data_type = text(record, "gdsType")
        .or_else(|| text(record, "gdstype"))
        .unwrap_or_default();
    let modality = infer_modality(&format!("{title} {summary} {data_type}"), fallback);
    Some(PublicDataset {
        id: format!("ncbi-geo-{}", accession.to_lowercase()),
        url: format!("https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accession}"),
        accession,
        title,
        source: "NCBI GEO".into(),
        modality,
        organism: text(record, "taxon"),
        sample_count: unsigned(record.get("n_samples")),
        summary: summary.chars().take(3000).collect(),
        data_types: (!data_type.is_empty())
            .then_some(data_type)
            .into_iter()
            .collect(),
        access: "open".into(),
    })
}

fn parse_encode_dataset(
    record: &Value,
    modality: DatasetModality,
    assay: &str,
) -> Option<PublicDataset> {
    let accession = text(record, "accession")?;
    let description = record
        .get("description")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .or_else(|| text(record, "description"))
        .unwrap_or_default();
    let title = text(record, "biosample_summary")
        .filter(|value| !value.is_empty())
        .or_else(|| (!description.is_empty()).then(|| description.clone()))
        .unwrap_or_else(|| format!("{assay} experiment {accession}"));
    Some(PublicDataset {
        id: format!("encode-{}", accession.to_lowercase()),
        url: format!("https://www.encodeproject.org/experiments/{accession}/"),
        accession,
        title,
        source: "ENCODE".into(),
        modality,
        organism: None,
        sample_count: record
            .get("replicates")
            .and_then(Value::as_array)
            .and_then(|items| u32::try_from(items.len()).ok()),
        summary: description.chars().take(3000).collect(),
        data_types: vec![assay.into()],
        access: "open".into(),
    })
}

fn research_query(brief: &ResearchBrief) -> String {
    let mut parts = vec![brief.question.trim_end_matches(['?', '？']).to_owned()];
    parts.extend(brief.keywords.iter().take(6).cloned());
    if let Some(population) = brief
        .population
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        parts.push(population.clone());
    }
    parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .map(|part| format!("({part})"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn infer_modality(text: &str, fallback: DatasetModality) -> DatasetModality {
    let normalized = text.to_lowercase();
    if ["spatial", "visium", "slide-seq"]
        .iter()
        .any(|term| normalized.contains(term))
    {
        DatasetModality::Spatial
    } else if ["single cell", "single-cell", "scrna", "snrna"]
        .iter()
        .any(|term| normalized.contains(term))
    {
        DatasetModality::SingleCell
    } else if ["atac-seq", "chromatin accessibility"]
        .iter()
        .any(|term| normalized.contains(term))
    {
        DatasetModality::AtacSeq
    } else if ["whole genome", "whole exome", "genomic", "wgs", "wes"]
        .iter()
        .any(|term| normalized.contains(term))
    {
        DatasetModality::Genomics
    } else {
        fallback
    }
}

fn text(record: &Value, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn unsigned(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .or_else(|| {
            value.and_then(Value::as_str).and_then(|value| {
                value
                    .chars()
                    .filter(char::is_ascii_digit)
                    .collect::<String>()
                    .parse()
                    .ok()
            })
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn maps_geo_metadata_and_prefers_specific_modality() {
        let dataset = parse_geo_dataset(
            &json!({
                "accession": "GSE12345",
                "title": "Spatial transcriptomics atlas",
                "summary": "Visium tissue cohort",
                "taxon": "Homo sapiens",
                "n_samples": "12",
                "gdsType": "Expression profiling by high throughput sequencing"
            }),
            DatasetModality::BulkRna,
        )
        .expect("valid GEO dataset");

        assert_eq!(dataset.modality, DatasetModality::Spatial);
        assert_eq!(dataset.sample_count, Some(12));
        assert_eq!(dataset.accession, "GSE12345");
    }

    #[test]
    fn maps_released_encode_experiment_metadata() {
        let dataset = parse_encode_dataset(
            &json!({
                "accession": "ENCSR123ABC",
                "biosample_summary": "human retinal cells",
                "description": ["Released chromatin accessibility experiment."],
                "replicates": ["/replicates/1/", "/replicates/2/"]
            }),
            DatasetModality::AtacSeq,
            "ATAC-seq",
        )
        .expect("valid ENCODE dataset");

        assert_eq!(dataset.modality, DatasetModality::AtacSeq);
        assert_eq!(dataset.sample_count, Some(2));
        assert_eq!(dataset.accession, "ENCSR123ABC");
    }
}
