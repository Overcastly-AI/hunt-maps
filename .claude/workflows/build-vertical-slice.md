# Workflow: build-vertical-slice

Take one backlog item from terrain maths through to a rendered, QA'd map layer.

Ridgeline's slices are deeper than a typical CRUD app's, because a new hunting
layer usually starts in the engine and ends in cartography. Skipping the first
phase is how you get a beautiful layer that is quietly wrong.

## Phases

1. **Engine** (`terrain-scientist`) — the operator itself, validated against
   analytically-known synthetic surfaces. Sign conventions documented.
   `requiredHalo()` updated. No new dependency.
2. **Schema** (`schema-architect`) — only if the feature persists anything.
   Geometry columns, indexes, `clientId`/`version` for anything syncable.
3. **API** (`backend-builder`) — endpoints, DTOs, authorisation, best-effort
   degradation when the DEM source is down.
4. **Map** (`map-builder`) — the `ridgeline://` layer, colour ramp, legend, the
   one-sentence hunting-language blurb, ordering anchor.
5. **Panel** (`frontend-builder`) — controls, missing-input handling, mobile.
6. **Review** (`code-reviewer`) — domain correctness first, then offline impact,
   then security.
7. **Field QA** (`field-qa`) — desktop, 390px mobile, and **a real offline
   cold-start run**.
8. **Analytics audit** (`analytics-auditor`) — mandatory if the slice shows any
   number to a user.
9. **Biology audit** (`game-biologist`) — mandatory if the slice added or changed
   any biological parameter: a slope band, a threshold, a resistance value, a
   timing window, a behavioural claim. It files a graded, cited row in
   `docs/EVIDENCE.md`. **`terrain-scientist` verifying the maths is not a
   substitute** — that confirms the number is applied correctly, not that it is
   true.
10. **Docs** — ROADMAP + BACKLOG ticked in the same commit as the code.

## The gate that is easy to skip and must not be

Phase 7's offline run. "The tests pass and it looks right online" has never
caught the failure that matters in this product.

## Script outline

```js
export const meta = {
  name: 'build-vertical-slice',
  description: 'One feature: engine → schema → API → map → panel → review → QA',
  phases: [{ title: 'Engine' }, { title: 'Backend' }, { title: 'Map' }, { title: 'Verify' }],
}

phase('Engine')
const engine = await agent(`Implement and validate the terrain operator for: ${args.item}`,
                           { agentType: 'terrain-scientist' })
phase('Backend')
await agent(`Schema + API for: ${args.item}. Engine notes: ${engine}`,
            { agentType: 'backend-builder' })
phase('Map')
await parallel([
  () => agent(`Map layer, ramp and legend for: ${args.item}`, { agentType: 'map-builder' }),
  () => agent(`Panel controls for: ${args.item}`, { agentType: 'frontend-builder' }),
])
phase('Verify')
const [review, qa, biology] = await parallel([
  () => agent(`Review the diff for: ${args.item}`, { agentType: 'code-reviewer' }),
  () => agent(`Field QA: offline cold start + ui-invariants suite: ${args.item}`, { agentType: 'field-qa' }),
  // Skipped only when the slice provably touched no biological parameter.
  () => agent(`Grade any biological parameter this slice added or changed; file to docs/EVIDENCE.md: ${args.item}`,
              { agentType: 'game-biologist' }),
])
return { review, qa, biology }
```
