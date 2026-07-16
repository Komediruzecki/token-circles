import { z } from 'zod'

// Disable Zod's JIT fast-path for the browser build.
//
// Zod probes whether it may JIT-compile validators by running `new Function('')`
// once, the FIRST time any schema is defined. Under our Content-Security-Policy
// that call is a `securitypolicyviolation` (script-src without 'unsafe-eval') —
// harmless (Zod catches the throw and falls back), but it spams the console and
// would hard-fail if the report-only policy is ever enforced. `jitless` skips the
// probe entirely; the fallback interpreter is what the browser used anyway.
//
// This MUST run before the first `z.object()` is evaluated — the probe fires and
// caches at schema-DEFINITION time, not at parse time. Schemas are defined at
// module load, so a statement in index.tsx's body is too late (the whole import
// graph evaluates first) AND importing this from the entry is ALSO too late under
// production bundling: Rollup's chunking evaluates the schema chunk before the
// entry's side-effect import (verified — the probe still fired). The reliable
// place is inside each schema-defining module, imported as its FIRST import: a
// module's imports always evaluate before its body, so `jitless` is set before
// that module's `z.object()`s regardless of chunk order. Wired into
// src/schemas/models.ts and src/core/validation.ts; any new schema module that
// defines schemas at load time should import this first too.
z.config({ jitless: true })
