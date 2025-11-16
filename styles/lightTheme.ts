const lightTheme = {
    name: "light",
    colors: {
        // Primary colors from splash screen - adjusted for light theme
        primary: "#4ECBA0", // Slightly darker mint for better contrast
        secondary: "#5BC0E8", // Adjusted blue for light backgrounds
        accent: "#B8865A", // Darker brown for visibility
        
        // Text colors - dark for contrast on light
        text: "#0A1628",
        textPrimary: "#0A1628",
        textSecondary: "#5A6677",
        textTertiary: "#7A8899",
        textQuaternary: "#A8B5C7",
        textQuinary: "#0A1628",
        
        // Background colors - clean whites with subtle tints
        background: "#FFFFFF",
        backgroundPrimary: "#FFFFFF",
        backgroundSecondary: "#F8FAFB",
        backgroundTertiary: "#F0F4F7",
        backgroundQuaternary: "#F8FAFB",
        backgroundQuinary: "#E8F0F3",
        
        // Borders - subtle with slight mint tint
        border: "#E0E7ED",
        borderPrimary: "#E0E7ED",
        borderSecondary: "#D1DBE3",
        
        // Standard colors
        white: "#FFFFFF",
        black: "#000000",
        gray: "#8B95A1",
        
        // Status colors - vibrant but accessible
        error: "#E74C3C",
        success: "#4ECBA0",
        warning: "#F39C12",
        info: "#5BC0E8",
        
        // Input styling
        inputBackground: "#F0F4F7",
        inputBorder: "#D1DBE3",
        inputText: "#0A1628",
        inputPlaceholder: "#A8B5C7",
    },
    fonts: {
        regular: "Poppins_400Regular",
        medium: "Poppins_500Medium",
        semiBold: "Poppins_600SemiBold",
        bold: "Poppins_700Bold",
    },
    spacing: {
        small: 8,
        medium: 16,
        large: 24,
    },
    fontSize: {
        small: 14,
        medium: 16,
        large: 18,
        title: 24,
    },
    borderRadius: {
        small: 8,
        medium: 16,
        large: 24,
    },
    mapstyle: [
        {
            featureType: "poi",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.business",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.government",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.medical",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.place_of_worship",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.school",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.sports_complex",
            stylers: [{ visibility: "off" }],
        },
    ],
};

export default lightTheme;
