import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mccarthy.fso',
  appName: 'McCarthy FSO',
  webDir: 'out',
  server: { androidScheme: 'https' },
  android: {
    useLegacyBridge: true,
  },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
