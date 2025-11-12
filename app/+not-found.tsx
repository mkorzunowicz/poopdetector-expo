import { View, StyleSheet } from 'react-native';
import { Link, Stack } from 'expo-router';
import { tr } from "@/i18n/i18n"; // Import i18n

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: tr('NotFoundScreen.oops') }} />
      <View style={styles.container}>
        <Link href="/" style={styles.button}>
          {tr('NotFoundScreen.back')}
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
    justifyContent: 'center',
    alignItems: 'center',
  },

  button: {
    fontSize: 20,
    textDecorationLine: 'underline',
    color: '#fff',
  },
});
