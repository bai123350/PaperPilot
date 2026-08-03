use std::{collections::HashSet, thread, time::Duration};

use serde_json::Value;
use ureq::Agent;

use crate::contracts::{DatasetModality, PublicDataset, ResearchBrief};

const NCBI_DELAY: Duration = Duration::from_millis(350);
const NCBI_LIMIT_PER_MODALITY: &str = "3";
const ENCODE_LIMIT_PER_ASSAY: &str = "2";

const RELEVANCE_STOPWORDS: &[&str] = &[
    "about",
    "adult",
    "adults",
    "among",
    "analysis",
    "and",
    "are",
    "associated",
    "association",
    "available",
    "between",
    "biomedical",
    "biomarker",
    "biomarkers",
    "based",
    "can",
    "case",
    "cases",
    "cell",
    "cells",
    "child",
    "children",
    "cohort",
    "data",
    "dataset",
    "datasets",
    "does",
    "drive",
    "drives",
    "driving",
    "evidence",
    "effect",
    "effects",
    "elderly",
    "evaluate",
    "exists",
    "external",
    "find",
    "following",
    "for",
    "from",
    "have",
    "how",
    "homo",
    "human",
    "humans",
    "impact",
    "investigate",
    "investigating",
    "into",
    "identify",
    "male",
    "men",
    "mechanism",
    "mechanisms",
    "patient",
    "patients",
    "paediatric",
    "pediatric",
    "people",
    "public",
    "receiving",
    "related",
    "relationship",
    "research",
    "response",
    "role",
    "sample",
    "samples",
    "sapiens",
    "study",
    "studies",
    "subject",
    "subjects",
    "support",
    "supports",
    "systemic",
    "the",
    "therapy",
    "treatment",
    "tissue",
    "tissues",
    "undergoing",
    "use",
    "used",
    "using",
    "validation",
    "what",
    "when",
    "where",
    "which",
    "with",
    "women",
];

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
        datasets.extend(
            uids.filter_map(|uid| parse_geo_dataset(result.get(uid)?, fallback_modality))
                .filter(|dataset| dataset_matches_research_context(dataset, brief)),
        );
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
        datasets.extend(
            records
                .filter_map(|record| parse_encode_dataset(record, modality, assay))
                .filter(|dataset| dataset_matches_research_context(dataset, brief)),
        );
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

fn dataset_matches_research_context(dataset: &PublicDataset, brief: &ResearchBrief) -> bool {
    let required_terms = research_context_terms(brief);
    if required_terms.is_empty() {
        return false;
    }

    let searchable = format!(
        "{} {} {} {}",
        dataset.title,
        dataset.summary,
        dataset.organism.as_deref().unwrap_or_default(),
        dataset.data_types.join(" ")
    );
    let dataset_terms = normalized_terms(&searchable)
        .into_iter()
        .collect::<HashSet<_>>();
    required_terms
        .iter()
        .all(|term| dataset_terms.contains(term))
}

fn research_context_terms(brief: &ResearchBrief) -> Vec<String> {
    if let Some(population) = brief
        .population
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let terms = normalized_terms(population);
        if !terms.is_empty() {
            return terms;
        }
    }

    let keyword_terms = brief
        .keywords
        .iter()
        .flat_map(|keyword| normalized_terms(keyword))
        .collect::<Vec<_>>();
    if !keyword_terms.is_empty() {
        return deduplicate_terms(keyword_terms);
    }

    normalized_terms(&brief.question)
}

fn normalized_terms(value: &str) -> Vec<String> {
    let normalized = value
        .chars()
        .map(|character| {
            // GEO and ENCODE metadata are English; retaining a whole CJK phrase here
            // would make an otherwise useful English keyword fallback impossible.
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>();
    deduplicate_terms(
        normalized
            .split_whitespace()
            .filter(|term| term.chars().count() >= 3)
            .filter(|term| !RELEVANCE_STOPWORDS.contains(term))
            .map(str::to_owned)
            .collect(),
    )
}

fn deduplicate_terms(terms: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    terms
        .into_iter()
        .filter(|term| seen.insert(term.clone()))
        .collect()
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

    #[test]
    fn rejects_datasets_that_only_match_the_treatment_not_the_disease() {
        let brief = ResearchBrief {
            question: "What drives cisplatin resistance in lung cancer?".into(),
            population: Some("Adults with lung cancer".into()),
            intervention: Some("cisplatin".into()),
            comparison: None,
            outcomes: vec!["treatment response".into()],
            keywords: vec![],
            date_from: None,
            date_to: None,
            study_types: vec![],
        };
        let relevant = PublicDataset {
            id: "relevant".into(),
            accession: "GSE1".into(),
            title: "Cisplatin resistance in lung cancer".into(),
            source: "NCBI GEO".into(),
            modality: DatasetModality::BulkRna,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(12),
            summary: "RNA-seq of lung cancer cells after cisplatin exposure.".into(),
            data_types: vec!["RNA-seq".into()],
            access: "open".into(),
            url: "https://example.com/relevant".into(),
        };
        let unrelated = PublicDataset {
            id: "unrelated".into(),
            accession: "GSE2".into(),
            title: "Cisplatin-induced acute liver injury".into(),
            source: "NCBI GEO".into(),
            modality: DatasetModality::BulkRna,
            organism: Some("Mus musculus".into()),
            sample_count: Some(8),
            summary: "A hepatotoxicity study of cisplatin treatment.".into(),
            data_types: vec!["RNA-seq".into()],
            access: "open".into(),
            url: "https://example.com/unrelated".into(),
        };

        assert!(dataset_matches_research_context(&relevant, &brief));
        assert!(!dataset_matches_research_context(&unrelated, &brief));
    }

    #[test]
    fn falls_back_to_question_concepts_when_structured_context_is_absent() {
        let brief = ResearchBrief {
            question: "What drives cisplatin resistance in gastric cancer?".into(),
            population: None,
            intervention: None,
            comparison: None,
            outcomes: vec![],
            keywords: vec![],
            date_from: None,
            date_to: None,
            study_types: vec![],
        };
        let dataset = PublicDataset {
            id: "wrong-disease".into(),
            accession: "GSE3".into(),
            title: "FTO knockdown in osteosarcoma".into(),
            source: "NCBI GEO".into(),
            modality: DatasetModality::BulkRna,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(6),
            summary: "Cisplatin resistance in osteosarcoma cells.".into(),
            data_types: vec!["RNA-seq".into()],
            access: "open".into(),
            url: "https://example.com/wrong-disease".into(),
        };

        assert_eq!(
            research_context_terms(&brief),
            vec!["cisplatin", "resistance", "gastric", "cancer"]
        );
        assert!(!dataset_matches_research_context(&dataset, &brief));
    }

    #[test]
    fn uses_english_keywords_when_population_is_not_searchable_in_source_metadata() {
        let brief = ResearchBrief {
            question: "肺癌有哪些可复用的公共数据集？".into(),
            population: Some("肺癌患者".into()),
            intervention: None,
            comparison: None,
            outcomes: vec![],
            keywords: vec!["lung cancer".into()],
            date_from: None,
            date_to: None,
            study_types: vec![],
        };

        assert_eq!(research_context_terms(&brief), vec!["lung", "cancer"]);
    }
}
