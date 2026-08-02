import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { getTheme } from './src/theme';

function AppContent() {
  const theme = getTheme(true);

  return (
    <SafeAreaView style={styles.appContent}>
      <HomeScreen theme={theme} />
    </SafeAreaView>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#071426" />
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContent: {
    flex: 1,
    backgroundColor: '#071426',
  },
});

export default App;
