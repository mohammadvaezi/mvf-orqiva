<!-- [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close -->

# AI providers and reading files

Orqiva's agents work with the AI provider you choose: Anthropic, OpenAI, Azure OpenAI, Google Gemini,
Amazon Bedrock or xAI Grok. The same connections read your files: the text of PDFs and pictures, and
transcripts of recordings. Each call is counted, priced and kept with the work it belongs to.

## Connections

Under **Settings → AI providers**, an admin adds a connection for each provider the workspace uses. A
connection needs only what its provider needs:

| Provider       | What you enter                                                                                      | Reads                 |
| -------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Anthropic      | an API key (`sk-ant-…`)                                                                             | PDFs, pictures        |
| OpenAI         | an API key (`sk-…`)                                                                                 | PDFs, pictures, audio |
| Azure OpenAI   | the resource's endpoint (`https://name.openai.azure.com`) and its key; models are deployment names  | PDFs, pictures, audio |
| Google Gemini  | an API key from Google AI Studio                                                                    | PDFs, pictures, audio |
| Amazon Bedrock | the region, and a Bedrock API key or an access key ID with its secret (each request is then signed) | PDFs, pictures        |
| xAI Grok       | an API key (`xai-…`)                                                                                | pictures, audio       |
| Demo model     | nothing: it answers from fixed scripts, to try agents without a key                                 | —                     |

Keys are encrypted with the server's own key (`ORQIVA_SECRET_KEY`) as they arrive and are never shown
again. The table shows their last four characters. A key that looks like another provider's is refused.
Azure endpoints must be Azure addresses, so the server never calls an address in your own network by
mistake.

Each connection starts with suggested models, which you can change:

- the **model for agents** (for Azure: the deployment);
- the **model for reading files**, often a smaller and cheaper one;
- the **model for transcripts**.

**Test** asks the model for one word and shows the answer and how long it took. The table also shows each
connection's last call: when it worked, or the provider's own words when it failed.

## What each connection does

Below the table, choose:

- **Agents:** the connection agents think with.
- **When it fails:** the connection that takes over when the agents' connection cannot answer (no
  network, a rate limit, an outage, a key that stopped working). The run says which provider failed and
  which took over.
- **Reading files:** the connection that reads PDFs and pictures.
- **Transcripts:** the connection that writes out recordings.

A connection is offered only for what it can do. An agent can also have its own connection and model on
**Agents → Settings**, for example a Reviewer on Bedrock while the others use Azure.

## A project's own key

When a client pays for the AI of their project, add the project's own key under **Tokens and costs →
Prices and keys**. It replaces the workspace's key of the same provider for that project's agent runs
and file reads. The connection's address, region and models stay the same.

## Reading files

Every uploaded file that has no text of its own is read in the background. Uploads come from idea
sources, documents, test evidence, client requests and message attachments.

| File                                                  | How it is read                                                                 | Its text is called |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------ |
| Word (`.docx`)                                        | on the server, without a model                                                 | extracted          |
| PDF                                                   | by the reading connection                                                      | extracted          |
| Pictures (PNG, JPEG, GIF, WebP)                       | by the reading connection: the text, then a short description of what it shows | OCR                |
| Audio and video (MP3, M4A, WAV, OGG, WebM, MP4, FLAC) | by the transcript connection                                                   | transcript         |

The text then serves the agents and search. An idea's sources show how much text the Analyst reads,
or why a file has none yet. A file that could not be read has **Read again**.

- **Limits per file:** up to 25 MB for uploads. Some providers take less in one request: Anthropic 5 MB
  for a picture; Gemini about 14 MB; Bedrock 3.75 MB for a picture and 4.5 MB for a PDF. Grok reads no
  PDFs. A file over its provider's limit is not sent; the file says why.
- **Retries:** a passing failure (no network, a rate limit) is tried again after 1, 5 and 30 minutes.
- **Governance:** reads are work of the **Reader agent**. Switching it off, its monthly budget, and
  **Pause all agents** stop reading too. Each model read is kept as a Reader run with its tokens and
  cost.
- **Privacy:** the file goes to the provider of the connection that reads it. Choose a provider your
  agreements allow for your clients' material. Word files never leave the server.

## Prices and costs

**Tokens and costs → Prices and keys** lists a price for each model: per million tokens in and out, and,
for transcripts, per minute of audio. The prices that ship with Orqiva are estimates from the providers'
public price lists in October 2026 and say so. Set your own price for a model from a date, and it applies
from then on. **AI spend** shows the month by project, by provider, by model and by agent. A run that a
fallback finished counts for both providers.

## Troubleshooting

- **"The model provider answered 401 …":** the key is wrong or was revoked. Enter it again with
  **Change**.
- **"… answered 404 …" on Azure:** the deployment name is wrong. Azure models are your deployments'
  names, not the model names.
- **"Name the model this connection uses first":** Azure and Bedrock have no suggested models. Enter one
  with **Change**.
- **A file stays "not read":** no reading or transcript connection is chosen, the Reader agent is
  switched off, or the file is over the provider's limit. The file says which.
