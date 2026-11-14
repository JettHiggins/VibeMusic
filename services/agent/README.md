# Workstream 3 entry point

This directory belongs to the agent/backend teammate. No API calls or provider credentials are configured. Implement the FastAPI service and provider adapters here. Consume the root `packages/contracts/*.schema.json` and fixtures; the TypeScript/Zod source is authoritative. Run `python3 scripts/check_contracts.py` from the repository root to verify examples. See `docs/CONTRACTS.md` before implementing WebSocket behavior.
