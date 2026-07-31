export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/src/**/*.spec.ts'],
  collectCoverage: true,
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  coveragePathIgnorePatterns: [
    'node_modules',
    'src/main.ts',
    'src/server.ts',
    'src/telegram/bot.ts',
    'src/helpers/api.ts',
    'src/helpers/orders.ts',
    'src/helpers/websocket.ts',
    'src/jobs/entry.ts',
    'src/jobs/monitor.ts',
    'src/helpers/holidayCheck.ts',
    'src/helpers/scripMaster.ts',
    'src/store/index.ts',
    'src/notifier.ts',
    'src/analysis/generateReport.ts',
    'src/config/env.ts',
  ],
};
