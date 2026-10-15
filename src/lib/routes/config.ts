/**
 * Google Maps configuration. GOOGLE_MAPS_API_KEY (a server key with the Geocoding API,
 * Routes API and Maps Static API enabled) switches route planning from straight-line
 * estimates to real drive times. The *_URL variables are for testing against a mock.
 */
export interface MapsConfig {
  configured: boolean;
  apiKey: string | null;
  geocodeUrl?: string;
  routeMatrixUrl?: string;
  staticMapUrl?: string;
}

export function getMapsConfig(env: Record<string, string | undefined> = process.env): MapsConfig {
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim() || null;
  return {
    configured: !!apiKey,
    apiKey,
    geocodeUrl: env.GOOGLE_GEOCODING_URL?.trim() || undefined,
    routeMatrixUrl: env.GOOGLE_ROUTES_URL?.trim() || undefined,
    staticMapUrl: env.GOOGLE_STATIC_MAPS_URL?.trim() || undefined,
  };
}
