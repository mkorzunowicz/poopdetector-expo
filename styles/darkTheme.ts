const darkTheme = {
    name: "dark",
    colors: {
        // Primary colors from splash screen
        primary: "#5FD4A3", // Mint green accent (from the wave/grass)
        secondary: "#7DD3F8", // Light blue (from robot)
        accent: "#C89865", // Warm brown (from hat)
        
        // Text colors - high contrast for dark theme
        text: "#FFFFFF",
        textPrimary: "#FFFFFF",
        textSecondary: "#A8B5C7",
        textTertiary: "#7A8899",
        textQuaternary: "#5A6677",
        textQuinary: "#FFFFFF",
        
        // Background colors - deep navy like splash
        background: "#0A1628",
        backgroundPrimary: "#0A1628",
        backgroundSecondary: "#141B2B",
        backgroundTertiary: "#1E2936",
        backgroundQuaternary: "#141B2B",
        backgroundQuinary: "#1E2936",
        
        // Borders - subtle with mint tint
        border: "#2A3544",
        borderPrimary: "#2A3544",
        borderSecondary: "#374455",
        
        // Standard colors
        white: "#FFFFFF",
        black: "#000000",
        gray: "#6B7785",
        
        // Status colors with mint/teal theme
        error: "#FF6B6B",
        success: "#5FD4A3",
        warning: "#FFB84D",
        info: "#7DD3F8",
        
        // Input styling
        inputBackground: "#1E2936",
        inputBorder: "#2A3544",
        inputText: "#FFFFFF",
        inputPlaceholder: "#7A8899",
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
        { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
        {
            featureType: "administrative.locality",
            elementType: "labels.text.fill",
            stylers: [{ color: "#d59563" }],
        },
        {
            featureType: "poi",
            stylers: [{ visibility: "off" }],
        },
        {
            featureType: "poi.park",
            elementType: "geometry",
            stylers: [{ color: "#263c3f" }],
        },
        {
            featureType: "poi.park",
            elementType: "labels.text.fill",
            stylers: [{ color: "#6b9a76" }],
        },
        {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#38414e" }],
        },
        {
            featureType: "road",
            elementType: "geometry.stroke",
            stylers: [{ color: "#212a37" }],
        },
        {
            featureType: "road",
            elementType: "labels.text.fill",
            stylers: [{ color: "#9ca5b3" }],
        },
        {
            featureType: "road.highway",
            elementType: "geometry",
            stylers: [{ color: "#746855" }],
        },
        {
            featureType: "road.highway",
            elementType: "geometry.stroke",
            stylers: [{ color: "#1f2835" }],
        },
        {
            featureType: "road.highway",
            elementType: "labels.text.fill",
            stylers: [{ color: "#f3d19c" }],
        },
        {
            featureType: "transit",
            elementType: "geometry",
            stylers: [{ color: "#2f3948" }],
        },
        {
            featureType: "transit.station",
            elementType: "labels.text.fill",
            stylers: [{ color: "#d59563" }],
        },
        {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#17263c" }],
        },
        {
            featureType: "water",
            elementType: "labels.text.fill",
            stylers: [{ color: "#515c6d" }],
        },
        {
            featureType: "water",
            elementType: "labels.text.stroke",
            stylers: [{ color: "#17263c" }],
        },
    ],
};

export default darkTheme;
