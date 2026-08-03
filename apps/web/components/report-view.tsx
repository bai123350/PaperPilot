"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  Database,
  ExternalLink,
  FlaskConical,
  ShieldCheck,
  X,
} from "lucide-react";

import type {
  DatasetModality,
  EvidenceView,
  PublicDatasetView,
  ReportViewModel,
} from "../lib/types";

interface ReportViewProps {
  report: ReportViewModel;
}

export function ReportView({ report }: ReportViewProps) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const evidenceById = useMemo(
    () => new Map(report.evidence.map((item) => [item.id, item])),
    [report.evidence],
  );
  const selectedEvidence = selectedEvidenceId ? evidenceById.get(selectedEvidenceId) : undefined;

  return (
    <div className="report-layout">
      <main className="report-content">
        <section className="report-intro">
          <div className="section-kicker">
            <ShieldCheck size={16} aria-hidden="true" />
            Evidence-first report · Schema {report.schemaVersion}
          </div>
          <h1>{report.title}</h1>
          <p>{report.summary}</p>
          {report.themes?.length ? (
            <div className="tag-row" aria-label="研究主题">
              {report.themes.map((theme) => (
                <span className="tag" key={theme}>{theme}</span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="report-section" aria-labelledby="claims-heading">
          <div className="section-heading">
            <div>
              <span className="section-number">01</span>
              <h2 id="claims-heading">主要结论</h2>
            </div>
            <span className="section-meta">{report.claims.length} 条证据化结论</span>
          </div>
          <div className="claim-list">
            {report.claims.map((claim) => (
              <article className="claim-row" key={claim.id}>
                <CheckCircle2 size={20} aria-hidden="true" />
                <div>
                  <p>{claim.statement}</p>
                  <button
                    className="evidence-button"
                    type="button"
                    onClick={() => setSelectedEvidenceId(claim.evidenceIds[0])}
                  >
                    <BookOpenText size={15} aria-hidden="true" />
                    查看证据
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <RelatedDatasets datasets={report.relatedDatasets ?? []} />

        {report.gaps?.length ? (
          <section className="report-section" aria-labelledby="gaps-heading">
            <div className="section-heading">
              <div>
                <span className="section-number">03</span>
                <h2 id="gaps-heading">证据空白</h2>
              </div>
            </div>
            <ul className="gap-list">
              {report.gaps.map((gap) => <li key={gap}>{gap}</li>)}
            </ul>
          </section>
        ) : null}

        <section className="report-section" aria-labelledby="recommendations-heading">
          <div className="section-heading">
            <div>
              <span className="section-number">04</span>
              <h2 id="recommendations-heading">下一步研究方案</h2>
            </div>
            <span className="section-meta">按验证成本排序</span>
          </div>
          <div className="recommendation-grid">
            {report.recommendations.map((item, index) => (
              <article className="recommendation-card" data-testid="recommendation-card" key={item.id}>
                <div className="recommendation-index">0{index + 1}</div>
                <FlaskConical size={22} aria-hidden="true" />
                <h3>{item.title}</h3>
                <p className="recommendation-rationale">{item.rationale}</p>
                <dl>
                  <div><dt>可检验假设</dt><dd>{item.hypothesis}</dd></div>
                  <div><dt>最小验证</dt><dd>{item.minimalValidation}</dd></div>
                  <div><dt>停止条件</dt><dd>{item.stopCondition}</dd></div>
                </dl>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setSelectedEvidenceId(item.evidenceIds[0])}
                >
                  追溯依据 <ArrowRight size={15} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      {selectedEvidence ? (
        <EvidenceDrawer evidence={selectedEvidence} onClose={() => setSelectedEvidenceId(null)} />
      ) : null}
    </div>
  );
}

const DATASET_MODALITIES: Array<{ value: DatasetModality; label: string }> = [
  { value: "bulk_rna", label: "Bulk" },
  { value: "single_cell", label: "单细胞" },
  { value: "spatial", label: "空间转录组" },
  { value: "atac_seq", label: "ATAC" },
  { value: "genomics", label: "基因组" },
];

function RelatedDatasets({ datasets }: { datasets: PublicDatasetView[] }) {
  const [activeModality, setActiveModality] = useState<DatasetModality | "all">("all");
  const visibleDatasets = activeModality === "all"
    ? datasets
    : datasets.filter((dataset) => dataset.modality === activeModality);
  const sources = Array.from(new Set(datasets.map((dataset) => dataset.source)));

  return (
    <section className="report-section dataset-section" aria-labelledby="datasets-heading">
      <div className="section-heading">
        <div>
          <span className="section-number">02</span>
          <h2 id="datasets-heading">相关公共数据集</h2>
        </div>
        <span className="section-meta">
          {datasets.length ? `${datasets.length} 个数据集 · ${sources.join(" · ")}` : "未发现匹配数据集"}
        </span>
      </div>

      <div className="dataset-filters" aria-label="按数据类型筛选">
        <button
          className={activeModality === "all" ? "active" : ""}
          type="button"
          aria-pressed={activeModality === "all"}
          onClick={() => setActiveModality("all")}
        >
          全部 <span>{datasets.length}</span>
        </button>
        {DATASET_MODALITIES.map((option) => {
          const count = datasets.filter((dataset) => dataset.modality === option.value).length;
          return (
            <button
              className={activeModality === option.value ? "active" : ""}
              type="button"
              aria-pressed={activeModality === option.value}
              onClick={() => setActiveModality(option.value)}
              key={option.value}
            >
              {option.label} <span>{count}</span>
            </button>
          );
        })}
      </div>

      {visibleDatasets.length ? (
        <div className="dataset-list" aria-live="polite">
          {visibleDatasets.map((dataset) => (
            <article className="dataset-card" data-testid="dataset-card" key={dataset.id}>
              <div className="dataset-icon" aria-hidden="true">
                <Database size={19} />
              </div>
              <div className="dataset-body">
                <div className="dataset-eyebrow">
                  <span>{dataset.source}</span>
                  <strong>{dataset.accession}</strong>
                </div>
                <h3>{dataset.title}</h3>
                {dataset.summary ? <p>{dataset.summary}</p> : null}
                <div className="dataset-meta">
                  <span>{DATASET_MODALITIES.find((item) => item.value === dataset.modality)?.label}</span>
                  {dataset.organism ? <span>{dataset.organism}</span> : null}
                  {dataset.sampleCount != null ? <span>{dataset.sampleCount} 个样本</span> : null}
                  {dataset.dataTypes.map((dataType) => <span key={dataType}>{dataType}</span>)}
                </div>
              </div>
              <a
                className="dataset-link"
                href={dataset.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`在 ${dataset.source} 查看 ${dataset.accession}`}
              >
                查看数据 <ExternalLink size={15} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      ) : (
        <div className="dataset-empty" role="status">
          <Database size={21} aria-hidden="true" />
          <p>{datasets.length ? "当前类型暂无匹配数据集。" : "本次检索未发现可追溯的公共数据集。"}</p>
        </div>
      )}
    </section>
  );
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceView; onClose: () => void }) {
  return (
    <aside className="evidence-drawer" aria-label="证据详情">
      <div className="drawer-header">
        <div>
          <span className="section-kicker">Evidence Record</span>
          <h2>原文证据</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭证据">
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <blockquote>{evidence.excerpt}</blockquote>
      <dl className="evidence-metadata">
        <div><dt>文献</dt><dd>{evidence.paperTitle}</dd></div>
        <div><dt>位置</dt><dd>{evidence.locator}</dd></div>
        {evidence.pmid ? <div><dt>PMID</dt><dd>{evidence.pmid}</dd></div> : null}
        {evidence.doi ? <div><dt>DOI</dt><dd>{evidence.doi}</dd></div> : null}
      </dl>
      {evidence.pmid ? (
        <a
          className="primary-link"
          href={`https://pubmed.ncbi.nlm.nih.gov/${evidence.pmid}/`}
          target="_blank"
          rel="noreferrer"
        >
          在 PubMed 查看 <ArrowRight size={16} aria-hidden="true" />
        </a>
      ) : null}
    </aside>
  );
}
