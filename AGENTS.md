## Repository Context
- Project: **RecruitMCP Server** (Node/TypeScript CLI).
- Entry point: `npm run dev` (runs `tsx src/index.ts` → CLI agent loop).
- Core agents/tools: `recruitmentOrchestrator` orchestrates candidate/recruiter flows, using tools under `src/tools/*`, guardrails under `src/guardrails/*`, agent helpers in `src/agents/*`.
- Database: SQLite file `recruit.db` (path: workspace root) managed via `src/db/client.ts`.
- CLI session saved only in memory; no persistent storage beyond SQLite. `runEngine.ts` persists context and orchestrates tool calls.
- Environment: Node with `tsx`, `better-sqlite3`, `@openai/agents`; check `.env` for secrets if needed.

## Agent Rules
1. Always read `MEMORY.md` before starting work.
2. Update `MEMORY.md` when major architecture or functionality changes happen.
3. Do not rerun CLI (`npm run dev`) unless needed to verify changes.
4. Favor existing tools and services (e.g., `src/services/email.service.ts`, guardrails) before introducing replacements.

## Common Tasks
- Resume flow: candidate upload → `resume_extractor` tool → optional `update_resume_profile`.
- Recruiter flow: after authentication, use `create_job`, `find_matched_candidates`, `schedule_interview`, etc.
- CLI requests for job creation should now collect company, location, employment metadata.

## Quick Commands
- Start app: `npm run dev`.
- Run lint/tests (not yet defined) would be project-specific.

## Notes for Codex
- Database migrations use helper functions defined in `src/db/client.ts`.
- Any change to CLI messaging or persistence should reference `runEngine.ts`.
