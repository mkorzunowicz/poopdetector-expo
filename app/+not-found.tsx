import { tr } from "@/i18n/i18n";
import { useTheme } from '@/styles/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  return (
    <>
      <Stack.Screen options={{ title: tr('NotFoundScreen.oops') }} />
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <Ionicons name="alert-circle-outline" size={80} color={theme.colors.primary} />
        </View>
        <Text style={styles.title}>{tr('NotFoundScreen.oops')}</Text>
        <Link href="/" style={styles.button}>
          {tr('NotFoundScreen.back')}
        </Link>
      </View>
    </>
  );
}

const getStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    iconContainer: {
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 16,
    },
    button: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.primary,
      textDecorationLine: 'underline',
      paddingVertical: 12,
      paddingHorizontal: 24,
    },
  });
