# Workflow: autonomous-dev-loop

The full Ridgeline "org" loop for 24/7 autonomous development. Independent
auditors set direction, the groomer maintains the board, and the build loop
ships the top items — each reviewed, field-QA'd offline, and analytics-audited
if it shows a number. It loops **on completion**, not on a timer.

## Cadence

Each invocation runs **one batch** (audit → groom → build N items). When the
batch finishes, the orchestrator immediately launches the next, so iterations
chain back-to-back. Stop only when the Ready queue is empty and the auditors
propose nothing new, or the user says stop.

## Phases per batch

1. **Audit (parallel, independent)** — `product-auditor`, `engineering-auditor`
   and `analytics-auditor` review the current app and append prioritised
   findings to their own docs. They do not see each other's output first; the
   independence is the point, because three coordinated auditors converge on the
   same blind spots.
2. **Groom** — `backlog-groomer` ingests all three audits plus
   `docs/QA-FIELD.md`, the roadmap and git history, reconciles what actually
   shipped, dedupes, and refreshes the **Ready** queue.
3. **Build (parallel, commit-safe)** — pull the top N Ready items and build
   **disjoint** items concurrently, each in its own git worktree. For each:
   implement via the owning specialist → `code-reviewer` → `field-qa`
   (**including a real offline cold-start run**) → `analytics-auditor` if the
   change surfaces any number. Commit and tick the board **only if green**;
   otherwise discard the worktree and leave the item on the board.

## Guardrails

- **Never push a red build.** One commit per item.
- **Never merge a feature whose offline path was not verified by hand.** Unit
  tests do not catch OPFS eviction, service-worker activation races, or a
  partially-populated store.
- **Never merge a new user-facing number without an analytics-auditor pass.**
- Bounded batch size (N ≈ 2–4) so each run stays reviewable.
- Read-only roles (auditors, QA) never touch app code.
- `packages/terrain` must remain dependency-free.

## Script outline

```js
export const meta = {
  name: 'autonomous-dev-loop',
  description: 'Audit → groom → build, looping on completion',
  phases: [{ title: 'Audit' }, { title: 'Groom' }, { title: 'Build' }],
}

phase('Audit')
await parallel([
  () => agent('Deep product audit; append docs/AUDIT-PRODUCT.md; return ready items.',
              { agentType: 'product-auditor' }),
  () => agent('Deep engineering audit; append docs/AUDIT-ENGINEERING.md; return ready items.',
              { agentType: 'engineering-auditor' }),
  () => agent('Audit every user-facing number; append docs/AUDIT-ANALYTICS.md.',
              { agentType: 'analytics-auditor' }),
])

phase('Groom')
await agent('Reconcile against git log, dedupe, refresh the Ready queue in docs/BACKLOG.md.',
            { agentType: 'backlog-groomer' })

phase('Build')
const ready = /* parse top N disjoint Ready items from docs/BACKLOG.md */ []
await parallel(ready.map((item) => () =>
  agent(`Implement, review, field-QA offline, and commit-if-green: ${item}`,
        { isolation: 'worktree' })
))
// on completion: integrate green branches, then launch the next batch
```
