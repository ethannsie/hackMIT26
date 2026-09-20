# Textbook corpus for the Ask box

`server/corpus.ts` indexes every `*.json` in this directory at boot and hands the
best-matching passages to the local model when a visitor asks a question.

Nothing but this file is committed. The current OpenStax edition is
CC BY-NC-SA 4.0, so the built passages stay on the demo box. Build once there,
while it has internet:

```bash
cd ~/hackMIT26/corpus
curl -L -A Mozilla/5.0 -o university-physics-volume-1.pdf \
  "https://assets.openstax.org/oscms-prodcms/media/documents/university-physics-volume-1_-_WEB.pdf"
pdftotext -enc UTF-8 university-physics-volume-1.pdf university-physics-volume-1.txt
cd .. && npx tsx scripts/build-corpus.ts corpus/university-physics-volume-1.txt
```

(The PDF link comes from `https://openstax.org/apps/cms/api/v2/pages/82/`,
field `pdf_url`, if it moves.) Restart the API afterwards; `/api/health`
reports `corpus.chunks`. Volumes 2 and 3 work the same way if wanted; the
demo's four problem types are all Volume 1.

Attribution shown under answers: *OpenStax University Physics, CC BY-NC-SA 4.0*.
