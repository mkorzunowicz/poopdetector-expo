import { useEffect, useRef } from "react";
import { DeviceMotion } from "expo-sensors";
import { Platform } from "react-native";

interface UseShakeDetectorOptions {
  onShake: () => void;
  threshold?: number;
  timeout?: number;
}

/**
 * Hook to detect shake gesture on device
 * @param options Configuration options for shake detection
 */
export function useShakeDetector({
  onShake,
  threshold = 30, // Acceleration threshold for shake detection
  timeout = 500, // Minimum time between shake events (ms)
}: UseShakeDetectorOptions) {
  const lastShakeTime = useRef<number>(0);
  const subscriptionRef = useRef<any>(null);

  useEffect(() => {
    // Shake detection only works on native platforms
    if (Platform.OS === "web") {
      return;
    }

    let lastX = 0;
    let lastY = 0;
    let lastZ = 0;

    // Subscribe to device motion events
    const startListening = async () => {
      try {
        // Check if sensor is available
        const isAvailable = await DeviceMotion.isAvailableAsync();
        if (!isAvailable) {
          console.log("Device motion sensor not available");
          return;
        }

        // Set update interval (in milliseconds)
        DeviceMotion.setUpdateInterval(100);

        // Subscribe to motion updates
        subscriptionRef.current = DeviceMotion.addListener((data) => {
          const { x, y, z } = data.acceleration || { x: 0, y: 0, z: 0 };

          // Calculate acceleration change
          const deltaX = Math.abs(x - lastX);
          const deltaY = Math.abs(y - lastY);
          const deltaZ = Math.abs(z - lastZ);

          // Check if acceleration exceeds threshold
          if (deltaX + deltaY + deltaZ > threshold) {
            const now = Date.now();
            
            // Prevent multiple shake events in quick succession
            if (now - lastShakeTime.current > timeout) {
              lastShakeTime.current = now;
              onShake();
            }
          }

          // Update last values
          lastX = x;
          lastY = y;
          lastZ = z;
        });
      } catch (error) {
        console.error("Error setting up shake detector:", error);
      }
    };

    startListening();

    // Cleanup
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
      }
    };
  }, [onShake, threshold, timeout]);
}

export default useShakeDetector;
