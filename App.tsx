import React from 'react';
import { StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { getTheme } from './src/theme';
import { isVpnSupported } from './src/native/vpn';

function TopBar() {
  const insets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() === 'dark';
  const theme = getTheme(isDarkMode);

  return (
    <View
      style={[
        styles.topBar,
        {
          backgroundColor: theme.surface,
          paddingTop: insets.top + 12,
        },
      ]}>
      <Text style={[styles.title, { color: theme.primary }]}>VPNSky</Text>
    </View>
  );
}

function AppContent() {
  const isDarkMode = useColorScheme() === 'dark';
  const theme = getTheme(isDarkMode);

  return (
    <View style={styles.appContent}>
      <TopBar />
      <HomeScreen theme={theme} />
      {!isVpnSupported && (
        <View style={styles.notice}>
          <Text style={[styles.noticeText, { color: theme.onSurfaceVariant }]}>
            VPN requires Android; WireGuard cannot establish a tunnel on iOS.
          </Text>
        </View>
      )}
    </View>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContent: {
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#79747E',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  notice: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  noticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
});

export default App;