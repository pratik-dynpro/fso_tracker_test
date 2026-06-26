export interface TrackPoint {
  /** Stable UUID stamped at capture; the server upserts on it so retries are safe. */
  clientPingId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** ISO timestamp of when the reading was captured on the device */
  recordedAt: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TripSummary {
  tripId: string;
  driverName: string;
  jobRef: string | null;
  destAddress: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  distanceTotalMi: number;
}

export interface PositionDTO {
  tripId: string;
  driverName: string;
  jobRef: string | null;
  status: string;
  last: { lat: number; lng: number; recordedAt: string } | null;
  /** true if the last reading is older than the stale threshold (signal likely lost) */
  stale: boolean;
  distanceMeasuredMi: number;
  distanceEstimatedMi: number;
  distanceTotalMi: number;
  /** where the technician actually began (first GPS fix of the trip) */
  start: LatLng | null;
  /** the assigned job destination, if one was set */
  destination: (LatLng & { address?: string | null }) | null;
  /** straight-line distance from current position to the destination */
  distanceToGoMi: number | null;
  /** rough ETA in minutes (straight-line distance at an assumed average speed) */
  etaMin: number | null;
  track: { lat: number; lng: number; isGap: boolean; recordedAt: string }[];
}
