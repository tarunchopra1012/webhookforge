const path = require('path');
const ts = require('typescript');
const { pathsToModuleNameMapper } = require('ts-jest');

// tsconfig.json is the single source of truth for the alias map. Read it
// through the TypeScript API rather than require()-ing it, because the file
// contains comments and JSON.parse would choke on them.
const tsconfigPath = path.join(__dirname, 'tsconfig.json');
const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (error) {
  throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
}

const paths = config.compilerOptions.paths ?? {};

/**
 * rootDir is the repository root here and in test/jest-e2e.config.js, so a
 * single '<rootDir>/' prefix lines up with the './src/...' targets in
 * tsconfig. The two configs differ only in which directory they scan.
 */
const base = {
  rootDir: __dirname,
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: tsconfigPath }],
  },
  moduleNameMapper: pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
};

module.exports = {
  ...base,
  // Unit specs sit beside their source, per testing-standard.md.
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    // Declarations and wiring, with no branches worth a coverage number.
    '<rootDir>/src/main.ts',
    '<rootDir>/src/orm.ts',
    '\\.module\\.ts$',
    '<rootDir>/src/error.ts',
    '<rootDir>/src/event.ts',
    '<rootDir>/src/constant.ts',
    '/migration/',
  ],
  coverageDirectory: '<rootDir>/coverage',
};
