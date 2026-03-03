# ig-chat-exporter

A tool that archives your Instagram DM conversations to JSON.

## Requirements

- Node.js 18+
- pnpm
- Instagram cookies exported from your browser via [Cookie-Editor](https://cookie-editor.com/) or similar

## Setup

```sh
pnpm install
cp .env.example .env
```

Export your Instagram cookies as JSON and save them to a file (e.g. `cookies.json`). The required cookies are `sessionid`, `csrftoken`, `ds_user_id`, `mid`, and `ig_did`.

## Usage

```sh
pnpm dev
```

The interactive wizard will walk you through selecting threads and configuration. You can also pre-fill values with environment variables as mentioned in the `.env.example` file.

| Variable | Description |
|---|---|
| `IG_SESSION_FILE` | Path to session state file (created automatically) |
| `IG_COOKIE_FILE` | Path to exported browser cookies |
| `IG_OUTPUT_DIR` | Output directory for archives |

## Output

Each thread is saved to `{output_dir}/{thread_id}/archive.json` with the following structure:

```json
{
  "exported_at": 1709500000000,
  "exported_by": { "user_id": "123", "username": "you" },
  "thread": {
    "thread_id": "...",
    "thread_title": "group chat name",
    "is_group": true,
    "participants": [],
    "total_messages": 1200
  },
  "messages": [
    {
      "item_id": "...",
      "user": { "user_id": "456", "username": "someone" },
      "timestamp": 1709500000000,
      "item_type": "text",
      "text": "hello",
      "reactions": []
    }
  ]
}
```

Messages only include fields that are present and `text`, `media`, `link`, and `poll` are omitted when not applicable.

## Rate limiting

Two presets are available.

- **safe** — conservative delays between requests, recommended for large archives
- **fast** — shorter delays, higher risk of temporary blocks

The tool includes periodic cooldown pauses to reduce the chance of hitting Instagram's rate limits and risking your account.

## Resumable checkpoints

If the process is interrupted, a checkpoint file is saved. On the next run, fetching resumes from where it left off. Completed archives are merged incrementally and only new messages are fetched.

## Media

When media download is enabled, images, videos, audio, and other attachments are downloaded and included in the archive. Optional base64 encoding produces fully self-contained archives. HD profile pictures for all thread participants are also downloaded.

## Building

```sh
pnpm build
pnpm start
```
