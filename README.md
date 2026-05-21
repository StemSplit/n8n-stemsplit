# n8n-nodes-stemsplit

An [N8N](https://n8n.io) community node for [StemSplit](https://stemsplit.io) — AI-powered audio stem separation.

Extract vocals, drums, bass, guitar, piano, and other stems from any audio file using state-of-the-art AI models.

[![npm](https://img.shields.io/npm/v/n8n-nodes-stemsplit)](https://www.npmjs.com/package/n8n-nodes-stemsplit)
[![N8N Community Nodes](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

---

## Features

- **Separate Stems** — Submit an audio file and get a job ID immediately (fire-and-forget)
- **Separate Stems (Wait for Completion)** — Submit + poll until done, then return presigned download URLs for all stems
- **Get Job** — Fetch the current status and output URLs of any job by ID
- **List Jobs** — Paginate through your job history with optional status filtering
- **Get Balance** — Check your remaining credit balance

---

## Installation

### In N8N (Community Nodes UI)

1. Open **Settings → Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-stemsplit`
4. Click **Install**

### Via npm (self-hosted N8N)

```bash
npm install n8n-nodes-stemsplit
```

---

## Authentication

1. Go to [stemsplit.io/app/settings/api](https://stemsplit.io/app/settings/api) and generate an API key (starts with `sk_live_`).
2. In N8N, create a new **StemSplit API** credential and paste your key.

The node authenticates with `Authorization: Bearer <your-key>` on every request to `https://stemsplit.io/api/v1`.

---

## Operations

### Separate Stems

Submits an audio file for processing and **returns immediately** with the job ID. Use this when you want to submit many jobs in parallel and check status later with **Get Job**.

**Input source options:**
- **Binary File** — pass the audio file as a binary N8N item (e.g., from an HTTP Request or Read Binary File node)
- **URL** — provide a publicly accessible URL; StemSplit will fetch it server-side

**Parameters:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| Output Type | `VOCALS + Instrumental` | Which stems to separate into |
| Quality | `Best` | Processing quality (`Fast`, `Balanced`, `Best`) |
| Output Format | `MP3` | Output file format (`MP3`, `WAV`, `FLAC`) |
| File Name | _(auto)_ | Override the job's display name |
| Metadata | `{}` | Custom JSON object echoed back in all job responses |

**Output fields:** `id`, `status`, `progress`, `creditsRequired`, `estimatedSeconds`, `createdAt`, `options`, `input`, `metadata`

---

### Separate Stems (Wait for Completion)

Submits an audio file and **polls** until the job reaches `COMPLETED` (or throws on `FAILED`/timeout). Returns presigned download URLs for every stem.

Additional parameters:
| Parameter | Default | Description |
|-----------|---------|-------------|
| Timeout (Seconds) | `600` | Give up after this many seconds |
| Poll Interval (Seconds) | `5` | How often to check the job status |

**Output fields** (beyond the job fields above):
- `vocalsUrl` / `vocalsExpiresAt`
- `instrumentalUrl` / `instrumentalExpiresAt`
- `drumsUrl`, `bassUrl`, `otherUrl`, `pianoUrl`, `guitarUrl` (when applicable)

> Presigned URLs expire **1 hour** after the job completes. Output files expire and are deleted **14 days** after creation.

---

### Get Job

Fetch a job by its ID. Returns the same fields as **Separate Stems (Wait)** including any available output URLs.

---

### List Jobs

Returns a list of jobs with optional `status` filter and pagination via `limit`/`offset`.

---

### Get Balance

Returns:
```json
{
  "balanceSeconds": 3600,
  "balanceMinutes": 60,
  "balanceFormatted": "60 minutes",
  "updatedAt": "..."
}
```

**Credits:** 1 credit = 1 second of audio. Credits are charged at job creation. If your balance is insufficient, the node throws a `402 INSUFFICIENT_CREDITS` error.

---

## Output Types

| Value | Stems produced |
|-------|---------------|
| `VOCALS` | Vocals only |
| `INSTRUMENTAL` | Instrumental only |
| `BOTH` | Vocals + Instrumental |
| `FOUR_STEMS` | Vocals, Drums, Bass, Other |
| `SIX_STEMS` | Vocals, Drums, Bass, Other, Piano, Guitar *(requires Best quality)* |

---

## Supported Audio Formats

Input: `mp3`, `wav`, `flac`, `m4a`, `ogg`, `webm`, `aac`, `wma`
Max file size: **50 MB**

---

## Example Workflow

```
[HTTP Request (download audio)] → [StemSplit: Separate Stems (Wait)] → [HTTP Request (download vocals)]
```

Or with binary data from disk:

```
[Read Binary File] → [StemSplit: Separate Stems (Wait)] → [HTTP Request (save stems)]
```

---

## API Reference

The StemSplit public API base URL is `https://stemsplit.io/api/v1`.

Full OpenAPI spec: `GET https://stemsplit.io/api/v1/openapi`

Developer docs: [stemsplit.io/docs/api](https://stemsplit.io/docs/api)

---

## License

MIT © StemSplit
