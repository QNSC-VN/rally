export interface SprintSnapshot {
  id: string;
  tenantId: string;
  sprintId: string;
  snapshotDate: string; // YYYY-MM-DD
  totalPoints: number;
  completedPoints: number;
  remainingPoints: number;
  totalItems: number;
  completedItems: number;
  createdAt: Date;
}

export interface BurndownPoint {
  date: string;
  remainingPoints: number;
  completedPoints: number;
  remainingItems: number;
  completedItems: number;
}

export interface VelocityPoint {
  sprintId: string;
  sprintName: string;
  completedPoints: number;
  completedItems: number;
}

export interface SprintBurndownReport {
  sprintId: string;
  points: BurndownPoint[];
}

export interface VelocityReport {
  projectId: string;
  sprints: VelocityPoint[];
}
