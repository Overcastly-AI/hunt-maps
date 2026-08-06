/**
 * `@hunt-maps/shared` — contracts and analytics shared by every surface.
 *
 * Imported by the API, the web client, and the offline service worker. Keep it
 * dependency-light and side-effect free: it ships into a service worker bundle,
 * where an accidental Node import is a runtime failure the user only discovers
 * with no signal.
 */

export * from './domain.js';
export * from './analytics/selection.js';
export * from './rut.js';
