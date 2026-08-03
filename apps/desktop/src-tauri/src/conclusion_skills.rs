const LITERATURE_REVIEW_SKILL: &str = include_str!("../../../../skills/literature-review/SKILL.md");
const LITERATURE_REVIEW_WORKFLOW: &str =
    include_str!("../../../../skills/literature-review/references/core_workflow.md");
const CRITICAL_THINKING_SKILL: &str =
    include_str!("../../../../skills/scientific-critical-thinking/SKILL.md");
const CRITICAL_THINKING_CAPABILITIES: &str =
    include_str!("../../../../skills/scientific-critical-thinking/references/core_capabilities.md");
const CRITICAL_THINKING_EVIDENCE: &str = include_str!(
    "../../../../skills/scientific-critical-thinking/references/evidence_hierarchy.md"
);
const HYPOTHESIS_GENERATION_SKILL: &str =
    include_str!("../../../../skills/hypothesis-generation/SKILL.md");
const HYPOTHESIS_CONCEPTS: &str =
    include_str!("../../../../skills/hypothesis-generation/references/concepts_and_workflow.md");
const HYPOTHESIS_CAUSAL_CLAIMS: &str = include_str!(
    "../../../../skills/hypothesis-generation/references/causal_inference_and_claims.md"
);

pub const ACTIVE_CONCLUSION_SKILLS: [&str; 3] = [
    "literature-review",
    "scientific-critical-thinking",
    "hypothesis-generation",
];

pub fn conclusion_skill_guidance() -> String {
    let sections = [
        section(LITERATURE_REVIEW_SKILL, "### Synthesis"),
        section(LITERATURE_REVIEW_SKILL, "### Writing"),
        section(
            LITERATURE_REVIEW_WORKFLOW,
            "### Phase 5: Synthesis and Analysis",
        ),
        section(
            CRITICAL_THINKING_CAPABILITIES,
            "### 4. Evidence Quality Assessment",
        ),
        section(CRITICAL_THINKING_CAPABILITIES, "### 7. Claim Evaluation"),
        section(CRITICAL_THINKING_SKILL, "## Remember"),
        section(CRITICAL_THINKING_EVIDENCE, "### Basic Science Research"),
        section(
            CRITICAL_THINKING_EVIDENCE,
            "## Communicating Evidence Strength",
        ),
        section(HYPOTHESIS_GENERATION_SKILL, "## Keep the objects distinct"),
        section(HYPOTHESIS_CONCEPTS, "## Uncertainty vocabulary"),
        section(
            HYPOTHESIS_CAUSAL_CLAIMS,
            "## Start with the scientific target",
        ),
        section(HYPOTHESIS_CAUSAL_CLAIMS, "## Claim-language rules"),
    ];

    format!(
        "已调用本地技能：{}。以下规则从项目 skills 目录中的上游技能及其参考文件按需加载：\n\n{}",
        ACTIVE_CONCLUSION_SKILLS.join(", "),
        sections.join("\n\n")
    )
}

fn section<'a>(markdown: &'a str, heading: &str) -> &'a str {
    let Some(start) = markdown.find(heading) else {
        return "";
    };
    let body = &markdown[start..];
    let heading_level = heading
        .chars()
        .take_while(|character| *character == '#')
        .count();
    let end = body
        .match_indices("\n#")
        .find_map(|(index, _)| {
            let candidate = &body[index + 1..];
            let level = candidate
                .chars()
                .take_while(|character| *character == '#')
                .count();
            (level > 0 && level <= heading_level).then_some(index)
        })
        .unwrap_or(body.len());
    body[..end].trim()
}

#[cfg(test)]
mod tests {
    use super::{ACTIVE_CONCLUSION_SKILLS, conclusion_skill_guidance, section};

    #[test]
    fn extracts_only_the_requested_markdown_section() {
        let markdown = "# Root\n## First\nkeep\n### Child\nkeep too\n## Second\ndrop";
        assert_eq!(
            section(markdown, "## First"),
            "## First\nkeep\n### Child\nkeep too"
        );
    }

    #[test]
    fn embeds_each_selected_skill_without_optional_external_workflows() {
        let guidance = conclusion_skill_guidance();
        for skill in ACTIVE_CONCLUSION_SKILLS {
            assert!(guidance.contains(skill));
        }
        assert!(guidance.contains("Organize thematically"));
        assert!(guidance.contains("Basic Science Research"));
        assert!(guidance.contains("Associational"));
        assert!(guidance.contains("Mechanistic"));
        assert!(!guidance.contains("OPENROUTER_API_KEY"));
        assert!(!guidance.contains("generate_schematic.py"));
        assert!(guidance.len() < 18_000);
    }
}
