# Biomedical Evaluation

`biomedical_topics.json` contains the initial 20-topic review set. For each release, two biomedical reviewers score:

- retrieval coverage of known core papers;
- whether each sampled major claim is supported by its linked excerpt;
- whether each recommendation is testable and feasible;
- whether any output crosses into diagnosis or treatment advice.

Release gates are 100% resolvable formal citations, 100% structural Evidence Record coverage, and at least 90% sampled claim support. Human review results should be stored outside the repository because they may contain reviewer identities.
