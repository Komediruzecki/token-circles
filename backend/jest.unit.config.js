module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/test/unit/**/*.spec.js', '**/test/unit/**/*.test.js'],
  collectCoverageFrom: [
    'repositories/**/*.js',
    'services/**/*.js',
    'utils.js',
    'routes/**/*.js',
    '!node_modules/**',
    '!index.js',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  // Ratchet up as coverage increases. Target: 60%+ across the board.
  coverageThreshold: {
    global: {
      branches: 5,
      functions: 5,
      lines: 5,
      statements: 5,
    },
  },
  modulePaths: ['<rootDir>'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  verbose: true,
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/../test/__mocks__/styleMock.js',
  },
};
