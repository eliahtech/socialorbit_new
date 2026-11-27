import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId:'com.eliahtech.socialorbit', appName:'SocialOrbit',
  webDir:'../web/public',
  android:{allowMixedContent:false},
  plugins:{SplashScreen:{launchShowDuration:1500,backgroundColor:'#0B1F44'}}
};
export default config;
