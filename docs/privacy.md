# Privacy And Data Lifecycle

- Upload tickets expire after 15 minutes, are HMAC signed, and bind user, project, filename, and maximum size.
- PDF content is checked by media type, size, and `%PDF-` file signature.
- Local development stores files under user/project prefixes. Production OSS requests KMS encryption for every object.
- Celery Beat purges source files older than `PAPERPILOT_UPLOAD_RETENTION_HOURS`, default 24 hours.
- Project deletion cascades database records and deletes the matching object-storage prefix.
- Logs must contain identifiers, stage names, durations, and error classes only. Do not log briefs, excerpts, prompts, or model responses.
- The model adapter sends the structured brief, paper titles, and selected evidence excerpts only. It must use an enterprise endpoint that contractually disables training and retention.
- The product is research intelligence, not clinical decision support. Every report carries that disclaimer.
