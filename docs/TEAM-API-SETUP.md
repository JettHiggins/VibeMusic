# Backend provider setup

Use current engine-integration and SETUP.md. Local faster-whisper handles recognition; language providers interpret requests, never sample timing. Familiar commands retain the deterministic path. Leave GROOVE_LLM blank for parser-only operation. No credentials belong in the browser, GitHub, agent prompts or source.

## Selected migration: Google Cloud / Vertex AI — not implemented yet

Jett confirmed the friend's $10 credits are **Google Cloud credits**. WS3 must add a Vertex-capable adapter behind the existing bounded Deep Agents harness. Current runtime only supports OpenRouter; do not set a guessed GROOVE_LLM=gemini value and expect it to work.

Before a live test, identify the Cloud project linked to the credit-bearing billing account, verify the credit's eligible services/expiry and model access, enable the required API, and choose a supported project/location/model. Cloud credits are not proof that an arbitrary AI Studio key is covered. Check the actual credit terms in Cloud Billing.

Prefer each teammate's own authorized identity with Application Default Credentials; share project/location/model identifiers and grant appropriate project access rather than distributing a personal credential file. For local development Google's documented ADC login is `gcloud auth application-default login`. The adapter must select the intended project/quota project explicitly. Do not run setup or billable probes automatically as part of ordinary tests. See [Google Cloud authentication](https://cloud.google.com/vertex-ai/generative-ai/docs/start/gcp-auth) and [Cloud Billing credits](https://cloud.google.com/billing/docs/how-to/view-billing-account-credits).

WS3 publishes exact supported environment variables/install instructions with the adapter. Missing configuration, permissions, quota and timeout must produce sanitized actionable errors with no silent fallback/replay. Credits do not remove quota limits.

## Existing OpenRouter path

Install backend dependencies from the repository root with your virtualenv active:

```sh
python -m pip install -r services/agent/requirements-dev.txt -r services/agent/requirements-speech.txt -r services/agent/requirements-llm.txt
```

If services/agent/.env is absent, copy services/agent/.env.example there; preserve an existing file. Edit it locally:

```dotenv
GROOVE_LLM=openrouter
OPENROUTER_API_KEY=<entered locally>
GROOVE_LLM_MODEL=<supported free model ID>
GROOVE_STT=faster-whisper
GROOVE_STT_MODEL=base.en
```

Use distinct revocable keys delivered privately if continuing OpenRouter; account quota is shared. Never use VITE_ variables for credentials. Restart the backend after configuration changes:

```sh
python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

Enable browser audio/microphone and Hands-free commands. GET /healthz reports modes without credentials, not live-provider success. `python services/agent/scripts/language_check.py 'Set the tempo to110.'` is offline unless explicitly passed --live; live tests can use several requests. OpenRouter rejects paid models/fallback. Share sanitized failures, never .env contents.
