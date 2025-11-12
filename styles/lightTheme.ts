const lightTheme = {
    name: "light",
    colors: {
        primary: "#043F32",
        secondary: "#042628",
        textPrimary: "#0A2533",
        textSecondary: "#97A2B0",
        textTertiary: "#fff",
        textQuaternary: "#888",
        textQuinary: "#0A2533",
        backgroundPrimary: "#fff",
        backgroundSecondary: "#fff",
        backgroundTertiary: "#f7f7f7",
        backgroundQuaternary: "#fff",
        backgroundQuinary: "#e6ebf2",
        borderPrimary: "#e6ebf2",
        borderSecondary: "#e6ebf2",
        border: "#e6ebf2",
        white: "#fff",
        black: "#000",
        gray: "#999",
        error: "#FF4D4F",
        success: "#52C41A",
        warning: "#FAAD14",
        inputBackground: "#E8F4F8",
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
