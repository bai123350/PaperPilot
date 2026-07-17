export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type StageKey =
  | "planning"
  | "searching"
  | "deduplicating"
  | "screening"
  | "parsing"
  | "extracting"
  | "synthesizing"
  | "recommending"
  | "auditing";

export const researchStages: Array<{ key: StageKey; label: string; description: string }> = [
  { key: "planning", label: "问题结构化", description: "拆解研究问题与检索边界" },
  { key: "searching", label: "多源检索", description: "查询生物医学文献源" },
  { key: "deduplicating", label: "标识去重", description: "归一化 PMID、PMCID 与 DOI" },
  { key: "screening", label: "相关性筛选", description: "保留可支持研究问题的文献" },
  { key: "parsing", label: "全文解析", description: "解析摘要、章节与引用位置" },
  { key: "extracting", label: "证据抽取", description: "建立可追溯 Evidence Record" },
  { key: "synthesizing", label: "研究综合", description: "形成主题、时间线与争议" },
  { key: "recommending", label: "方向建议", description: "生成三个可验证研究方向" },
  { key: "auditing", label: "引用审计", description: "检查结论与证据的一致性" },
];

export function getStageProgress(status: RunStatus, stage: StageKey | null): number {
  if (status === "completed") return 100;
  if (!stage) return 0;
  const index = researchStages.findIndex((item) => item.key === stage);
  return index < 0 ? 0 : Math.round(((index + 1) / researchStages.length) * 100);
}
