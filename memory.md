## Memory Log
- **2026-03-12**: Captured baseline RecruitMCP architecture: Node/TypeScript CLI (`npm run dev` → `tsx src/index.ts`), SQLite `recruit.db`, orchestrator agent routing to candidate/recruiter tools, and helper services/guardrails.
- **Schema notes**: Resume, job, application, interview tables live in `src/db/client.ts`; `ensure*` helpers keep migrations safe and are invoked from `src/core/runEngine.ts`.
- **Agent state**: `runWithoutStreaming` (thread + context) retains CLI conversation during a single process run; no built-in persistence yet.

> Update this file whenever you make major architecture or functionality changes so future runs know what shifted.
