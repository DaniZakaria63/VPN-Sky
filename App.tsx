import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';

function AppContent() {
  return (
    // HomeScreen owns its bottom inset (it has to sit above the system nav bar), so the
    // provider-level SafeAreaView only handles the top and sides to avoid double padding.
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.appContent}>
      <HomeScreen />
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
