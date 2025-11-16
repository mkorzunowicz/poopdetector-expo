import OnboardingCarousel from "@/components/OnboardingCarousel";
import { tr } from "@/i18n/i18n";
import { useTheme } from "@/styles/ThemeContext";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

const WelcomeScreen: React.FC = () => {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const handleOnboardingComplete = () => {
    // persist that onboarding has been completed so we can skip it next launch
    try {
      AsyncStorage.setItem('@onboardingCompleted', 'true');
    } catch (err) {
      console.warn('Failed to persist onboarding completion', err);
    }

    router.replace("/(tabs)");
  };

  const handleLogin = () => {
    // Login not implemented yet, redirect to tabs
    router.replace("/(tabs)");
  };

  useEffect(() => {
    const initializeApp = async () => {
      try {

        // Add a timeout to prevent spinner from being stuck forever
        // Check if the user already completed onboarding
        const completed = await AsyncStorage.getItem('@onboardingCompleted');

        if (completed === 'true') {
          // already completed, navigate straight to main tabs
          router.replace('/(tabs)');
          return;
        }

        // Not completed yet — show onboarding
        setShowOnboarding(true);
        setLoading(false);
      } catch (err) {
        setError(tr("OnboardingScreen.errorInit"));
        console.error("Error initializing app:", err);
      }
    };

    initializeApp();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  if (showOnboarding) {
    return (
      <SafeAreaProvider>
        <OnboardingCarousel
          onComplete={handleOnboardingComplete}
          onLogin={handleLogin}
        />
      </SafeAreaProvider>
    );
  }

  // Fallback - shouldn't normally reach here
  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <Text style={styles.errorText}>{tr('OnboardingScreen.somethingWentWrong')}</Text>
      </View>
    </SafeAreaProvider>
  );
};

export default WelcomeScreen;

const getStyles = (theme: any) =>
  StyleSheet.create({
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.colors.backgroundSecondary,
    },
    errorText: {
      marginTop: 10,
      color: "red",
      fontSize: 14,
      textAlign: "center",
    },
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.colors.backgroundSecondary,
      paddingHorizontal: 20,
    },
  });
