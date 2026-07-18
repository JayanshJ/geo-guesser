// Single source for the arcade hub's display name. Rename here; CSS mirrors
// it via the --arcade-name token, and the DOM is filled by applyArcadeName()
// from this one constant so there's no second place to edit.
export const ARCADE_NAME = 'THE ARCADE';

// Fill every [data-arcade-name] element with the arcade title. Idempotent +
// null-safe so it can run before the hub exists.
export function applyArcadeName() {
  document.querySelectorAll('[data-arcade-name]').forEach((el) => {
    el.textContent = ARCADE_NAME;
  });
}