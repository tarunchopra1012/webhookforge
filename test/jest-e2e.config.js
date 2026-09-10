const unit = require('../jest.config');

// Reuses the unit config's transform and its tsconfig-derived alias map —
// the single source of truth lives in tsconfig.json. Only the scanned
// directory and the file pattern differ. Keys are picked explicitly rather
// than spread, because Jest warns about any key it does not recognise.
module.exports = {
  rootDir: unit.rootDir,
  moduleFileExtensions: unit.moduleFileExtensions,
  testEnvironment: unit.testEnvironment,
  transform: unit.transform,
  moduleNameMapper: unit.moduleNameMapper,
  roots: ['<rootDir>/test'],
  testRegex: '.e2e-spec\\.ts$',
};
