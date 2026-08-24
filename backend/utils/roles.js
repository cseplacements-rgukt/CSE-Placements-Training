// Central role predicates. Staff hierarchy: super_admin > admin > coordinator.
const SUPER_ADMIN = "super_admin";
const ADMIN = "admin";
const COORDINATOR = "coordinator";
const STUDENT = "student";

const ROLE_DISPLAY_NAMES = {
  student: "Student",
  coordinator: "Coordinator",
  admin: "Admin",
  super_admin: "Super Admin",
};

// Roles with full operational access across exams/questions/reports/etc.
const PLATFORM_ADMIN_ROLES = [ADMIN, SUPER_ADMIN];

// Every non-student staff tier.
const STAFF_ROLES = [COORDINATOR, ADMIN, SUPER_ADMIN];

const isPlatformAdmin = (role) => PLATFORM_ADMIN_ROLES.includes(role);
const isStaff = (role) => STAFF_ROLES.includes(role);

module.exports = {
  SUPER_ADMIN,
  ADMIN,
  COORDINATOR,
  STUDENT,
  ROLE_DISPLAY_NAMES,
  PLATFORM_ADMIN_ROLES,
  STAFF_ROLES,
  isPlatformAdmin,
  isStaff,
};
