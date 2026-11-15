# Team OpenRouter setup

Use the reviewed engine-integration baseline. Main is not the running product. Install Python/Node and engine assets per SETUP.md first. Each teammate receives a distinct revocable OpenRouter key through encrypted password-manager/one-time secret sharing. Do not send keys in GitHub, agent chats or source. Keys under one account share its quota.

From the repository root with your Python environment active:

```sh
python -m pip install -r services/agent/requirements-dev.txt -r services/agent/requirements-speech.txt -r services/agent/requirements-llm.txt
```

If services/agent/.env does not already exist, copy services/agent/.env.example there. Never overwrite existing local configuration. Open that ignored file in your editor and set:

```dotenv
GROOVE_LLM=openrouter
OPENROUTER_API_KEY=<your distinct key, entered locally>
GROOVE_LLM_MODEL=inclusionai/ling-3.2-flash:free
GROOVE_STT=faster-whisper
GROOVE_STT_MODEL=base.en
```

Only the backend reads this file. Process environment variables take precedence. Do not use VITE_ variables or paste a secret into a shell command/agent prompt. Start the backend (restart an existing instance after config/code changes):

```sh
python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

In another terminal run npm run dev, open Vite's URL, enable audio/microphone and select Hands-free commands. Local speech downloads the model on first use. OpenRouter is language interpretation, not speech recognition or sample timing. GET /healthz reports language/speech mode without credentials. Health alone does not prove live provider success.

Optional explicit live test (sends this text and compact session summary; can consume several model requests):

```sh
python services/agent/scripts/language_check.py 'Set the tempo to 110 beats per minute.' --live
```

Omit --live for an offline parser-only result. Current free-model candidate is not a proven winner. Configuration rejects paid models/fallback; quota/auth/timeout failures leave state unchanged. Tell agents the key is configured locally and must never be printed; they do not need its value in conversation. If an error occurs, share the sanitized result, not the .env file. Leave GROOVE_LLM blank to use the standalone parser without provider calls.
