module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-native-firebase)/)',
  ],
  moduleNameMapper: {
    '^@react-native-firebase/(app|remote-config)$': '<rootDir>/__mocks__/rnfirebase.ts',
  },
};
