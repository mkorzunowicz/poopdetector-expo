// utils/timeout.ts
// Shared timeout utilities for all network requests

/**
 * Helper function to create a timeout promise with proper cleanup
 */
export function createTimeoutPromise(timeoutMs: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    
    // Store timeout ID for potential cleanup
    (reject as any).timeoutId = timeoutId;
  });
}

/**
 * Helper function to race a promise against a timeout with cleanup
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const timeoutPromise = createTimeoutPromise(timeoutMs, message);
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    // Clear timeout if promise resolves first
    if ((timeoutPromise as any).timeoutId) {
      clearTimeout((timeoutPromise as any).timeoutId);
    }
    return result;
  } catch (error) {
    // Clear timeout on error
    if ((timeoutPromise as any).timeoutId) {
      clearTimeout((timeoutPromise as any).timeoutId);
    }
    throw error;
  }
}

/**
 * Standard timeout duration for backend requests
 */
export const BACKEND_REQUEST_TIMEOUT = 15000; // 15 seconds

/**
 * Shorter timeout for simple operations
 */
export const SHORT_REQUEST_TIMEOUT = 10000; // 10 seconds

/**
 * Long timeout for file uploads or complex operations
 */
export const LONG_REQUEST_TIMEOUT = 30000; // 30 seconds
