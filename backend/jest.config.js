module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>', '../test'],
  testMatch: ['**/e2e/backend-api/**/*.spec.js'],
  collectCoverageFrom: ['**/*.js', '!node_modules/**', '!index.js'],
  setupFilesAfterEnv: ['../test/jest.setup.js'],
  verbose: true,
  transformIgnorePatterns: ['node_modules/(?!(chai)/)'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/../test/__mocks__/styleMock.js',
  },
};
