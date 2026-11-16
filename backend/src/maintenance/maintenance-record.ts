import type { MaintenanceWindow } from './domain/maintenance-window.js';

/** A stored maintenance window as the service hands it on: plain values, ids as strings. */
export interface MaintenanceRecord extends MaintenanceWindow {
  id: string;
  message: string;
  /** The admin account that created it. Never part of a public response. */
  createdBy: string;
  createdAt: Date;
}

export interface NewMaintenanceRecord extends MaintenanceWindow {
  message: string;
  createdBy: string;
}
