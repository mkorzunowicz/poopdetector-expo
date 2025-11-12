import { tr } from "@/i18n/i18n";
import { ThemeProvider, useTheme } from "@/styles/ThemeContext";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
// import { PostHogProvider } from 'posthog-react-native'
import { LanguageProvider, useLanguage } from "@/providers/LanguageProvider";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from 'react-native-toast-message';

// Suppress keep-awake warning in development (known Expo Android emulator issue)
LogBox.ignoreLogs(['Unable to activate keep awake']);

export default function RootLayout() {

  return (
    // <PostHogProvider
    //   apiKey={process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? ""}
    //   options={{
    //     host: "https://eu.i.posthog.com",
    //   }}>

    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LanguageProvider>
              <ThemeProvider>
                  <ThemedStack />
              </ThemeProvider>
        </LanguageProvider>
        <Toast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
    // </PostHogProvider>
  );
}

// Separate component to use `useTheme()` safely inside `ThemeProvider`
function ThemedStack() {
  const { theme, currentTheme } = useTheme();
  const { languageChanged } = useLanguage();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary, }}>
      <StatusBar style={currentTheme === "dark" ? "light" : "dark"} backgroundColor={theme.colors.backgroundPrimary} />
      <Stack
        key={`stack-${languageChanged}`}
        screenOptions={{
          animation: "ios_from_right",
          headerBackButtonDisplayMode: "generic",
          headerStyle: {
            backgroundColor: theme.colors.backgroundPrimary,
          },
          headerTintColor: theme.colors.textPrimary,
          headerBackTitle: "",

          headerTitleStyle: {
            fontWeight: "bold",
          },
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{ headerShown: false, title: tr("Screens.back") }}
        />
        <Stack.Screen name="index" options={{
          headerShown: false,
        }} />
        <Stack.Screen 
          name="permissions" 
          options={{
            headerShown: false,
            title: "Permissions"
          }} 
        />
        <Stack.Screen 
          name="devices" 
          options={{
            headerShown: true,
            title: "Camera Devices"
          }} 
        />
        <Stack.Screen 
          name="media" 
          options={{
            headerShown: false,
            title: "Media"
          }} 
        />
        <Stack.Screen name="+not-found" />
        
      </Stack>
    </View>
  );
}
