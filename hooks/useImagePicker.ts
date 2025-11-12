import { launchImageLibraryAsync } from "expo-image-picker";
import { useState } from "react";

export default function useImagePicker() {
    const [imageUri, setImageUri] = useState<string | undefined>(undefined);

    const pickImage = async () => {
        const result = await launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.7,
        });
        if (!result.canceled && result.assets?.length) {
            const { uri } = result.assets[0];
            setImageUri(uri);
        }
    };
    return { imageUri,setImageUri, pickImage };
};
