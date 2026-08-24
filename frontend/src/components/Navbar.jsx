import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/* ── SVG Icons ───────────────────────────────────────────────── */
const HomeIcon = () => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const PlusIcon = () => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
  </svg>
);

const ClipboardIcon = () => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <rect x="8" y="2" width="8" height="4" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>
  </svg>
);

const ShieldIcon = () => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const LogoutIcon = () => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const ChartIcon = () => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

/* ── Role display helper ─────────────────────────────────────── */
const formatRole = (role) => {
  const map = {
    student:     "Student",
    coordinator: "Coordinator",
    admin:       "Admin",
    super_admin: "Super Admin",
  };
  return map[role] || role;
};

/* ═══════════════════════════════════════════════════════════════
   Navbar Component
   ═══════════════════════════════════════════════════════════════ */
const NAV_LINK_BASE =
  "flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-medium transition-colors duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const NAV_LINK_IDLE = "text-stone-600 hover:bg-primary-light hover:text-ink";
const NAV_LINK_ACTIVE = "bg-primary text-white hover:bg-primary";

const BrandMark = ({ size = "md" }) => (
  <div
    className={`flex shrink-0 items-center justify-center rounded-sm bg-primary font-bold tracking-tight text-white ${
      size === "lg" ? "h-9 w-9 text-[15px]" : "h-8 w-8 text-sm"
    }`}
  >
    CP
  </div>
);

const Navbar = () => {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const close = () => setMobileOpen(false);

  const isExamTeam = ["coordinator", "admin", "super_admin"].includes(userProfile?.role);
  const isRosterManager = ["admin", "super_admin"].includes(userProfile?.role);

  return (
    <>
      {/* ── Mobile top bar ─────────────────────────────── */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[15px] font-semibold text-ink">CSE Placements Training</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-primary-light hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <MenuIcon />
        </button>
      </div>

      {/* ── Sidebar overlay (mobile) ───────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-stone-900/40 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface transition-transform duration-200 ease-out lg:z-20 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <Link
          to="/dashboard"
          onClick={close}
          className="flex items-center gap-3 border-b border-line px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
        >
          <BrandMark size="lg" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-ink">CSE Placements</div>
            <div className="text-xs text-ink-muted">Training</div>
          </div>
        </Link>

        {/* Nav links */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          <span className="block px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            Main
          </span>

          <Link
            to="/dashboard"
            className={`${NAV_LINK_BASE} ${isActive("/dashboard") ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
            onClick={close}
          >
            <HomeIcon /> Dashboard
          </Link>

          {userProfile?.role === "student" && (
            <Link
              to="/my-submissions"
              className={`${NAV_LINK_BASE} ${isActive("/my-submissions") ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
              onClick={close}
            >
              <ChartIcon /> My Results
            </Link>
          )}

          {isExamTeam && (
            <>
              <span className="block px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                Admin
              </span>
              <Link
                to="/create-exam"
                className={`${NAV_LINK_BASE} ${isActive("/create-exam") ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
                onClick={close}
              >
                <PlusIcon /> Create Mock Test
              </Link>
            </>
          )}

          {isRosterManager && (
            <Link
              to="/admin"
              className={`${NAV_LINK_BASE} ${isActive("/admin") ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
              onClick={close}
            >
              <ShieldIcon /> Admin Panel
            </Link>
          )}

          <span className="block px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            Account
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className={`${NAV_LINK_BASE} ${NAV_LINK_IDLE} w-full`}
          >
            <LogoutIcon /> Sign Out
          </button>
        </nav>

        {/* User footer */}
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-sm bg-primary-light px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-light text-[13px] font-semibold text-accent-dark">
              {userProfile?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-medium text-ink">
                {userProfile?.name || "User"}
              </div>
              <div className="truncate text-xs text-ink-muted">
                {formatRole(userProfile?.role)}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Navbar;
