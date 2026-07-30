# PaperPilot vendored research skills

PaperPilot embeds selected, local-only guidance from these skills when generating the
`主要结论` section of a live research report:

- `literature-review`
- `scientific-critical-thinking`
- `hypothesis-generation`

Source: [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills)
at commit `ab2f84ab10597c59fac186ecda6d5edd5dcc8b92`.

The upstream skill folders are kept intact. PaperPilot does not run their optional
network tools, image generation, or document-generation workflows. The desktop Rust
backend compiles only the sections needed for thematic evidence synthesis, biological
interpretation, claim calibration, and alternative explanations into the report prompt.

See `LICENSE.K-Dense-AI.md` for the upstream MIT license.
