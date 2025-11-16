import { useTheme } from "@/styles/ThemeContext";
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, useWindowDimensions } from "react-native";

function BottomTabNavigator() {
  const { theme } = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.textPrimary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        headerShadowVisible: false,
        headerTintColor: theme.colors.textPrimary,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: '',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <Ionicons name={focused ? 'images' : 'images-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          tabBarHideOnKeyboard: true,
          title: '',
          headerShown: true,
          
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
              
            <Ionicons name={focused ? 'camera' : 'camera-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "",
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} color={color} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}

// Main Component - Switches Layout Based on Screen Width
export default function ResponsiveLayout() {
  const { width } = useWindowDimensions();
  return <BottomTabNavigator />;
}

// Styles
const styles = StyleSheet.create({
  pin: {
    width: 50,
    height: 50,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  poopPinImage: {
    width: 65,
    height: 65,
  },
  profileButton: {
    width: 50,
    height: 50,
    right: -10,
    bottom: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    position: "absolute",
    borderRadius: 0,
    bottom: -5,
    shadowColor: "#555",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
});
