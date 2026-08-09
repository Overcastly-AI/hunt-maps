/**
 * `components/properties` — BACKLOG R1, the door into property boundary
 * drawing.
 *
 * ## Mounting instruction (App.tsx wires routing; this package does not)
 *
 * Add, inside `<Routes>`, each wrapped in `RequireAuth`
 * (`components/auth/RequireAuth.tsx`) — every one of these calls an
 * authenticated endpoint, unlike the map dashboard route:
 *
 * ```tsx
 * <Route path="/properties" element={<RequireAuth><PropertiesListScreen /></RequireAuth>} />
 * <Route path="/properties/new" element={<RequireAuth><PropertyCreateScreen /></RequireAuth>} />
 * <Route path="/properties/:id" element={<RequireAuth><PropertyDetailScreen /></RequireAuth>} />
 * <Route path="/properties/:id/boundary" element={<RequireAuth><PropertyBoundaryEditScreen /></RequireAuth>} />
 * ```
 *
 * Order matters only in that `/properties/new` must not be swallowed by a
 * `/properties/:id` route placed before it — the block above is already in
 * a safe order (React Router matches `new` as a literal before `:id` would
 * even if reordered, but keeping literal segments first reads more clearly).
 *
 * Nothing here reads or writes `App.tsx`'s own state — every screen owns its
 * data via `lib/api/properties.ts`'s hooks.
 */

export { PropertiesListScreen } from './PropertiesListScreen';
export { PropertyDetailScreen } from './PropertyDetailScreen';
export { PropertyCreateScreen } from './PropertyCreateScreen';
export { PropertyBoundaryEditScreen } from './PropertyBoundaryEditScreen';
export { BoundaryEditor, type BoundaryEditorSnapshot } from './BoundaryEditor';
export { PropertyBoundaryPreview } from './PropertyBoundaryPreview';

import './properties.css';
