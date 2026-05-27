# n8n-nodes-stemsplit

[![npm](https://img.shields.io/npm/v/n8n-nodes-stemsplit)](https://www.npmjs.com/package/n8n-nodes-stemsplit)
[![N8N Community Nodes](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Separate vocals, drums, bass, and other stems from any audio file — directly inside N8N. `n8n-nodes-stemsplit` connects your workflows to the [StemSplit API](https://stemsplit.io), letting you remove vocals from a song, isolate instrumentals, extract drum tracks, or split full 6-stem mixes (vocals, drums, bass, guitar, piano, other) — without any ML infrastructure.

Submit audio via URL, binary upload, YouTube video URL, or SoundCloud track URL, wait for processing, and get presigned download URLs for each stem — all as native N8N nodes.

---

## What It Does

Accepts audio via **public URL**, **binary file upload**, **YouTube video URL**, or **SoundCloud track URL**. Submits to the StemSplit API for processing. Returns presigned download URLs for each stem.

| Operation | When to use it |
|-----------|----------------|
| **Separate Stems (Wait)** | You want vocals, drums, bass, etc. back immediately in the same workflow — submits and polls until complete |
| **Separate Stems** | Fire-and-forget — submit many jobs in parallel and poll status later |
| **Get Job** | Check status or retrieve output URLs for a previously submitted job |
| **List Jobs** | Browse job history or filter by status (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`) |
| **Get Balance** | Check remaining credits before a batch run |

Outputs presigned download URLs for: **vocals · instrumental · drums · bass · piano · guitar · other**

---

## Installation

### Via the N8N Community Nodes UI

1. Open **Settings → Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-stemsplit`
4. Click **Install**

### Via npm (self-hosted N8N)

```bash
npm install n8n-nodes-stemsplit
```

---

## Credentials

1. Go to [stemsplit.io/app/settings/api](https://stemsplit.io/app/settings/api) and generate an API key (format: `sk_live_...`).
2. In N8N, add a new **StemSplit API** credential and paste your key.

The node sends `Authorization: Bearer <key>` on every request to `https://stemsplit.io/api/v1`.

---

## Operations

### Separate Stems

Submits audio for processing and **returns immediately** with a job ID. Use this when you want to submit many jobs in parallel and poll status later with **Get Job**.

**Input source:**
- **Binary File** — pass audio as a binary N8N item (from an HTTP Request, Read Binary File, or any binary-capable node)
- **URL** — provide a publicly accessible URL; StemSplit fetches it server-side
- **YouTube URL** — paste any YouTube video URL; outputs vocals + instrumental (MP3, best quality)
- **SoundCloud URL** — paste any SoundCloud track URL; outputs vocals + instrumental (MP3, best quality)

> **Note:** For YouTube and SoundCloud inputs, Output Type, Quality, and Format options are fixed (Vocals + Instrumental, Best quality, MP3). The node ignores those fields if set.

**Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Output Type | `VOCALS + Instrumental` | Which stems to extract (see Output Types below) |
| Quality | `Best` | Processing quality: `Fast`, `Balanced`, or `Best` |
| Output Format | `MP3` | Output file format: `MP3`, `WAV`, or `FLAC` |
| File Name | _(auto)_ | Override the job's display name |
| Metadata | `{}` | Custom JSON echoed back in all job responses |

**Output fields:** `id`, `status`, `progress`, `creditsRequired`, `estimatedSeconds`, `createdAt`, `options`, `input`, `metadata`

---

### Separate Stems (Wait for Completion)

Submits audio and **polls** until the job reaches `COMPLETED` — or throws on `FAILED` or timeout. Returns presigned download URLs for every stem.

**Input source:**
- **Binary File** — pass audio as a binary N8N item (from an HTTP Request, Read Binary File, or any binary-capable node)
- **URL** — provide a publicly accessible URL; StemSplit fetches it server-side
- **YouTube URL** — paste any YouTube video URL; outputs vocals + instrumental (MP3, best quality)
- **SoundCloud URL** — paste any SoundCloud track URL; outputs vocals + instrumental (MP3, best quality)

> **Note:** For YouTube and SoundCloud inputs, Output Type, Quality, and Format options are fixed (Vocals + Instrumental, Best quality, MP3). The node ignores those fields if set.

**Additional parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Timeout (Seconds) | `600` | Give up after this many seconds |
| Poll Interval (Seconds) | `5` | How often to check job status |

**Additional output fields:**
- `vocalsUrl` / `vocalsExpiresAt`
- `instrumentalUrl` / `instrumentalExpiresAt`
- `drumsUrl`, `bassUrl`, `otherUrl`, `pianoUrl`, `guitarUrl` (when applicable)

> **Note:** Presigned URLs expire **1 hour** after job completion. Output files are deleted **14 days** after creation.

---

### Get Job

Fetch a single job by ID. Returns the same fields as **Separate Stems (Wait)**, including all available output URLs.

---

### List Jobs

Returns a paginated list of jobs. Optional `status` filter (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`) and pagination via `limit`/`offset`.

---

### Get Balance

Returns your current credit balance:

```json
{
  "balanceSeconds": 3600,
  "balanceMinutes": 60,
  "balanceFormatted": "60 minutes",
  "updatedAt": "2026-05-21T00:00:00Z"
}
```

**Credit model:** 1 credit = 1 second of audio. Credits are deducted at job submission. If your balance is insufficient, the node throws a `402 INSUFFICIENT_CREDITS` error.

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

**Input:** `mp3`, `wav`, `flac`, `m4a`, `ogg`, `webm`, `aac`, `wma`  
**Max file size:** 50 MB

---

## Example Workflows

### Basic n8n vocal remover pipeline

```
[HTTP Request: download audio]
  → [StemSplit: Separate Stems (Wait)]
  → [HTTP Request: download vocals URL]
  → [Write Binary File: save vocals.mp3]
```

### Batch stem splitter from local files

```
[Read Binary File: song.mp3]
  → [StemSplit: Separate Stems (Wait), Output: SIX_STEMS]
  → [Split In Batches]
  → [HTTP Request: upload each stem to S3]
```

### YouTube stem separator

```
[StemSplit: Separate Stems (Wait), Input: YouTube URL]
  → [HTTP Request: download vocals URL]
  → [Write Binary File: save vocals.mp3]
```

### Fire-and-forget with webhook callback

```
[Webhook trigger]
  → [StemSplit: Separate Stems]      ← returns job ID instantly
  → [Set: store job ID in DB]
  → [Cron: poll every 30s via Get Job]
  → [IF: status === COMPLETED]
  → [HTTP Request: notify downstream service]
```

---

## Why StemSplit?

StemSplit runs state-of-the-art source separation models (HTDemucs and similar) on GPU infrastructure purpose-built for audio. If you need to [separate vocals online](https://stemsplit.io/vocal-remover) without managing your own ML stack, StemSplit's API gives you:

- **Sub-minute turnaround** on most tracks (Fast/Balanced quality)
- **High-fidelity six-stem output** — vocals, drums, bass, piano, guitar, other
- **Simple credit model** — pay per second of audio processed, no subscriptions required
- **No file hosting needed** — pass a URL and StemSplit fetches it server-side
- **YouTube & SoundCloud support** — separate stems directly from a video or track URL, no downloading required

Full API docs: [stemsplit.io/docs/api](https://stemsplit.io/docs/api)  
OpenAPI spec: `GET https://stemsplit.io/api/v1/openapi`

---

## Requirements

- N8N v0.200 or later
- A StemSplit account with an API key — sign up at [stemsplit.io](https://stemsplit.io)
- Sufficient credit balance for your audio files (check with **Get Balance**)

---

## License

MIT © StemSplit
