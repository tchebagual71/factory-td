// Test-time stand-in for the 'phaser' module (aliased in vitest.config.ts).
// Game modules import Phaser for types and for calls on scene objects the
// tests inject as mocks, so an empty export is enough to load them in node.
export default {};
