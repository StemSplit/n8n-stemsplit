# n8n-nodes-stemsplit

**npm package:** `n8n-nodes-stemsplit`
**GitHub repo:** https://github.com/StemSplit/n8n-stemsplit (this folder has its own git repo)
**npm page:** https://www.npmjs.com/package/n8n-nodes-stemsplit

## Publishing

Publishing is handled via GitHub Actions with provenance (required for N8N community node verification).

To release a new version:
1. Bump version in `package.json`
2. Commit and push to `main` of the n8n-stemsplit repo (NOT the musicai monorepo)
3. Create a GitHub release: `gh release create vX.Y.Z --repo StemSplit/n8n-stemsplit --title "vX.Y.Z" --notes "..."`
4. CI will automatically publish to npm with provenance

The npm token is stored in `.env.local` (gitignored).

## Important notes
- This folder has its own `.git` repo separate from the musicai monorepo
- Changes here need to be committed and pushed to github.com/StemSplit/n8n-stemsplit
- Do NOT commit these changes to the musicai monorepo git
- The N8N community node submission requires provenance — always publish via CI, never `npm publish` locally
