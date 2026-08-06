# Workflow: ui-integrity-loop

A standing loop that keeps the interface honest, running independently of
feature work.

## Why this is a standing loop, like terrain and offline

The repo already runs `terrain-validation-loop` and `offline-integrity-loop`
independently, because both failure modes are silent. The UI has exactly the
same property and it took longer to admit:

- A terrain defect does not crash; the map just lies.
- Offline support rots because everything is developed and reviewed online.
- **A UI defect does not fail a test; the DOM reports success while the user
  cannot click the button.**

Every UI defect found in this repo so far was found by the founder looking at a
screenshot: a white attribution bar destroying night vision, a brand chip
stretched to 600px, a drawer sitting on top of the conditions bar, a popover
that painted and could not be clicked. All of them shipped past green suites.

That is not a QA failure, it is a missing loop.

## Each pass

1. **Run the automated floor.**
   ```bash
   cd apps/web && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm exec playwright test ui-invariants
   ```
   Hit-testability, trigger stability, touch targets, chrome collisions, focus
   visibility, horizontal overflow, contrast, panel density. Any failure is
   assumed real until disproven — **never tune an assertion until it passes.**

2. **Capture and look.** Run the screenshot suite across desktop and 390px
   mobile, in every overlay state (nothing open, drawer open, each popover
   open). Look at them. Classes 5 and 6 in the `catching-ui-defects` skill —
   wrong-shaped containers and overlays that collide — have fuzzy thresholds and
   taste is not automatable.

3. **Diff against last pass.** What moved? Was every change intended? An
   unintended layout shift is usually a specificity collision or a grid column
   sized by a sibling.

4. **Audit new surfaces for the floor.** Any component added since the last pass:
   does it use design-system primitives, or did someone re-implement a button?
   Are new colours in `tokens.ts` or hard-coded? Does a new overlay participate
   in the collision check?

5. **Close the loop on by-eye finds.** For every defect found by looking rather
   than by assertion, add the invariant that would have caught it. If none can,
   say so — the boundary between automatable and not is worth knowing precisely.

## Guardrails

- `field-qa` runs this and does **not** modify application code; it files to
  `docs/QA-FIELD.md` and hands fixes to `frontend-builder` / `map-builder`.
- A pass that finds nothing is a real result. Record what was checked so
  coverage accumulates rather than being re-derived each time.
- The invariants raise the floor. They never replace looking.

## Script outline

```js
export const meta = {
  name: 'ui-integrity-loop',
  description: 'Automated UI invariants + screenshot review, looping independently of features',
  phases: [{ title: 'Invariants' }, { title: 'Review' }, { title: 'File' }],
}

phase('Invariants')
const invariants = await agent(
  'Run apps/web ui-invariants; report failures with file:line and user-visible symptom. Do not weaken assertions.',
  { agentType: 'field-qa' },
)

phase('Review')
const review = await parallel([
  () => agent('Capture desktop + 390px screenshots in every overlay state; review for wrong-shaped containers and colliding overlays.',
              { agentType: 'field-qa' }),
  () => agent('Audit components added since the last pass for design-system adherence and hard-coded values.',
              { agentType: 'frontend-builder' }),
])

phase('File')
await agent(`Write findings to docs/QA-FIELD.md, each with the invariant that would have caught it: ${JSON.stringify({ invariants, review })}`,
            { agentType: 'field-qa' })
```
