module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>', '../tests'],
  testMatch: ['**/tests/e2e/backend-api/**/*.spec.js'],
  collectCoverageFrom: ['**/*.js', '!node_modules/**', '!index.js'],
  setupFilesAfterEnv: ['../test/jest.setup.js'],
  verbose: true,
  transformIgnorePatterns: ['node_modules/(?!(chai)/)'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/../tests/__mocks__/styleMock.js',
  },
};
