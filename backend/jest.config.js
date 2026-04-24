export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/../test/backend/**/*.test.js'],
  collectCoverageFrom: ['**/*.js', '!node_modules/**', '!index.js'],
  setupFilesAfterEnv: ['<rootDir>/../test/jest.setup.js'],
  verbose: true,
}