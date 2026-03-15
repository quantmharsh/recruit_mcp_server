## Repository Context
- Project: **RecruitMCP Server** (Node/TypeScript CLI).
- Entry point: `npm run dev` (runs `tsx src/index.ts` -> CLI agent loop).
- Core agents/tools: `recruitmentOrchestrator` orchestrates candidate and recruiter flows, using tools under `src/tools/*`, guardrails under `src/guardrails/*`, and specialist agents under `src/agents/*`.
- Database: SQLite file `recruit.db` at the workspace root, managed via `src/db/client.ts`.
- CLI session is process-local only; `src/core/runEngine.ts` keeps the in-memory thread/context for one CLI run and performs schema `ensure*` migrations at startup.
- Environment: Node with `tsx`, `better-sqlite3`, `@openai/agents`, `resend`, and `zod`; check `.env` for secrets if needed.

## Agent Rules
1. Always read `memory.md` before starting work. Older notes may mention `MEMORY.md`, but the tracked file in this workspace is lowercase.
2. Update `memory.md` when major architecture or functionality changes happen.
3. Do not rerun CLI (`npm run dev`) unless needed to verify changes.
4. Favor existing tools and services (for example `src/services/email.service.ts`, guardrails, and current agent/tool wiring) before introducing replacements.

## Common Tasks
- Resume flow: candidate upload -> `resume_extractor` tool -> optional `update_resume_profile`.
- Candidate flow: after authentication, use `list_available_jobs`, `recommend_jobs`, `apply_to_job`, and `list_my_interviews`.
- Recruiter flow: after authentication, use `create_job`, `list_my_jobs`, `find_matched_candidates`, `list_job_candidates`, `get_candidate_details`, `schedule_interview`, and `list_my_interviews`.
- CLI requests for job creation should collect company, location, employment metadata, remote friendliness, and contact email when available.

## Quick Commands
- Start app: `npm run dev`.
- Run lint/tests: not defined yet in `package.json`.

## Notes for Codex
- Database migrations use helper functions defined in `src/db/client.ts`.
- Any change to CLI messaging or persistence should reference `src/core/runEngine.ts`.
- Email delivery is centralized through `src/services/email.service.ts` using Resend.
