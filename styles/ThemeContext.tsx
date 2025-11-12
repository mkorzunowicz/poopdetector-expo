import React, { createContext, useContext, useState, ReactNode } from "react";
import lightTheme from "@/styles/lightTheme";
import darkTheme from "@/styles/darkTheme";
import { Appearance, useColorScheme } from 'react-native';
const themes = {
  light: lightTheme,
  dark: darkTheme,
};

type ThemeType = "light" | "dark";

interface ThemeContextProps {
  theme: typeof lightTheme;
  currentTheme: ThemeType;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeType>(useColorScheme() ?? "light");

  const toggleTheme = () => {
    setCurrentTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme: themes[currentTheme], currentTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextProps => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
