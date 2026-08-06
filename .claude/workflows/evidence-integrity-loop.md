# Workflow: evidence-integrity-loop

A standing loop that keeps the *biology* honest, running independently of
feature work.

## Why this is its own loop and not part of terrain-validation

These two questions look similar and are completely different:

- **`terrain-validation-loop` asks:** is 22° applied correctly? Is the Gaussian
  centred where the code says, does the field carry the right units, does the
  operator match its closed-form answer?
- **This loop asks:** *does a whitetail actually bed at 22°?*

The first is answerable from the source. The second is only answerable from the
literature, and no amount of test coverage will surface it. `idealSlopeDeg: 22`
passes every test in the repo, renders a confident colour on a map, and is a
number somebody made up.

That is the fourth silent-failure class. The repo already runs standing loops for
the other three — terrain maths lies without crashing, offline support rots
because development happens online, UI defects pass while the user cannot click.
A wrong biological constant is the same shape: **applied perfectly, and simply
not true.**

## Why it must not be run by whoever wrote the parameter

The evidence register was originally written by the orchestrator — the same
party that invented most of the numbers in it. Having the author of a guess
grade their own guess is not an audit, and it showed: nine rows sat at
🔴 Assumed with no attempt to move them, and several 🟢 grades were assigned on
the strength of a single search.

`game-biologist` runs this loop. It is read-only on application code: it files
cited findings and the build agents implement them.

## Each pass

1. **Inventory before researching.** Grep the engine for magic numbers — default
   parameter values, thresholds, tolerances, resistance tables, decay constants.
   Anything a biologist could disagree with belongs in `docs/EVIDENCE.md`.
   **A parameter that is in the code and not in the register is a defect**, and
   finding one means the merge gate leaked.

2. **Attack the reds.** Take the 🔴 Assumed rows in priority order and try to
   move them. A row that genuinely cannot be supported should be documented as
   *definitively* unsupported, with what was searched — so nobody re-searches it
   every quarter.

3. **Re-examine the greens.** Grades already assigned are not settled,
   particularly any assigned by a non-biologist. Confirm the source says what the
   register claims it says. **Downgrading a grade is a successful outcome**, not
   a regression.

   **Every 🟢 and 🔵 row must name the study's species and sample.** This is the
   cheapest possible check and it is not a formality — it is how this loop caught
   `escape terrain ≥10% slope` sitting at 🟢 Measured on the strength of a study
   about *humans wearing a Fitbit* across a university nature preserve. A row
   that cannot state "n animals, which species, where" is not Measured, whatever
   the citation looks like. Two traps this specifically catches:

   - **A human-locomotion paper laundered into a deer model.** The engine already
     carries one (Tobler); it acquired a second without anyone noticing, because
     both are about moving across terrain and the abstract reads plausibly.
   - **Units carried across from an abstract without dimensional analysis.** A
     figure recorded as `5.9 kcal·kg⁻¹·m⁻¹` rather than `~23 J` is a 1000×
     error that no biological intuition flags, because the number itself looks
     unremarkable. Sanity-check every energetic against `mgh` and state the
     implied efficiency; a value implying <5% or >60% efficiency is a units bug.

4. **Check scope.** Most whitetail literature is regional. A Midwest-validated
   parameter may be wrong in the Appalachians, the Ozarks or Texas brush. Flag
   scope on every row. Separately: the product claims "deer or other large
   game" while every parameter is whitetail-derived — that gap either gets
   per-species scoping or the claim gets narrowed.

5. **Check for drift into folklore.** Has anything crept in that is hunting
   media dressed as science? The standing refusals — a lunar rut predictor,
   absolute-pressure thresholds rather than trend — need re-checking whenever a
   new predictive claim appears.

6. **File implementable findings.** A finding without a number a build agent can
   use is half a job. Give the value, the citation, the uncertainty, and the
   grade change it earns.

## Guardrails

- Cite real sources. **Never invent a citation.** "No literature found" is a
  complete and useful result.
- Hunting media is evidence of 🟡 Doctrine, never 🟢 Measured. Mislabelling it is
  a defect equal to inventing a number.
- Where studies conflict, report the range rather than picking a midpoint and
  presenting it as settled.
- **Know which channels reach a source before spending a pass on the network.**
  Verified by hand: `curl https://raw.githubusercontent.com/...` returns 200 and
  `git clone --depth 1 --filter=blob:none` works for any public repo (into the
  scratchpad, never the working tree). `curl` to any other host returns `000` at
  CONNECT — which looks exactly like the journal being down, and is not.
  `WebSearch`/`WebFetch` are declared on the agent but come back
  `No such tool available` in some sessions; that is an environment fact, not a
  mistake, so drop to the channels that work rather than retrying.
- When nothing reaches the literature, the honest output is
  `no literature found — searched, unreachable`. **Never a citation you did not
  read**, and never a grade upgraded on the strength of a remembered abstract.
- A pass that moves nothing is still a result: record what was searched.

## Script outline

```js
export const meta = {
  name: 'evidence-integrity-loop',
  description: 'Vet every biological parameter against the literature; keep docs/EVIDENCE.md honest',
  phases: [{ title: 'Inventory' }, { title: 'Research' }, { title: 'File' }],
}

phase('Inventory')
const unregistered = await agent(
  'Grep packages/terrain and packages/shared for biological magic numbers. Return any parameter NOT present in docs/EVIDENCE.md — those are gate leaks.',
  { agentType: 'game-biologist' },
)

phase('Research')
// Reds first, then re-examine the greens. Separate calls so a failed search on
// one parameter cannot swallow the rest of the pass.
const findings = await parallel([
  () => agent('Attack the 🔴 Assumed rows in docs/EVIDENCE.md in priority order. Cite or definitively document as unsupported.',
              { agentType: 'game-biologist' }),
  () => agent('Re-examine every 🟢 Measured and 🔵 Inferred row. Confirm the source says what the register claims. Downgrades are successes.',
              { agentType: 'game-biologist' }),
])

phase('File')
await agent(`Update docs/EVIDENCE.md: grades, citations, count line, priority-actions table. Unregistered params found: ${unregistered}`,
            { agentType: 'game-biologist' })
// Orchestrator files the resulting backlog items — game-biologist writes docs only.
```
