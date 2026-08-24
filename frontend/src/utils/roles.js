// Role tiers used across route guards and UI labels.
export const STAFF_ROLES = ["coordinator", "admin", "super_admin"];
export const EXAM_TEAM_ROLES = ["coordinator", "admin", "super_admin"];
export const ROSTER_MANAGER_ROLES = ["admin", "super_admin"];

export const formatRoleName = (role) =>
  ({
    student: "Student",
    coordinator: "Coordinator",
    admin: "Admin",
    super_admin: "Super Admin",
  }[role] || role);
