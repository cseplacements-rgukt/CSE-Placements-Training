import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { formatRoleName } from "../utils/roles";
import { examService } from "../services/examService";
import { adminService } from "../services/adminService";
import AppLayout from "../components/AppLayout";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";
import Card, { CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import Skeleton from "../components/ui/Skeleton";
import Pagination from "../components/ui/Pagination";
import usePagedData from "../hooks/usePagedData";
import { Table, THead, TRHead, TH, TBody, TR, TD } from "../components/ui/Table";
import { Input, Select } from "../components/ui/Input";
import useDebouncedValue from "../hooks/useDebouncedValue";

const BATCH_YEARS = Array.from({ length: 12 }, (_, i) => 2020 + i);
const PAGE_SIZE = 25;

const TAB_BASE =
  "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:px-4";
const TAB_ACTIVE = "border-primary text-ink";
const TAB_IDLE = "border-transparent text-ink-muted hover:border-stone-300 hover:text-ink";

const trustToneClass = (score) =>
  score < 50 ? "text-danger" : score < 75 ? "text-warning" : "text-success";

const StatusBadge = ({ active }) => (
  <Badge dot variant={active ? "success" : "neutral"}>
    {active ? "Active" : "Inactive"}
  </Badge>
);

const StaffRow = React.memo(function StaffRow({
  member,
  isSelf,
  isSuperAdmin,
  onChangeRole,
  onToggleStatus,
  onDelete,
}) {
  const canChangeTier =
    isSuperAdmin && ["admin", "coordinator"].includes(member.role) && !isSelf;
  return (
    <TR className={!member.isActive ? "opacity-60" : ""}>
      <TD>
        <span className="font-medium text-ink">
          {member.name}
          {isSelf ? " (you)" : ""}
        </span>
      </TD>
      <TD className="text-ink-muted">{member.email}</TD>
      <TD>
        {canChangeTier ? (
          <select
            value={member.role}
            onChange={(e) => onChangeRole(member, e.target.value)}
            aria-label={`Change tier for ${member.name}`}
            className="h-8 rounded-sm border border-line bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          >
            <option value="coordinator">Coordinator</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
          formatRoleName(member.role)
        )}
      </TD>
      <TD><StatusBadge active={member.isActive} /></TD>
      <TD className="whitespace-nowrap text-[13px] text-ink-muted">
        {new Date(member.createdAt).toLocaleDateString()}
      </TD>
      <TD>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => onToggleStatus(member)}>
            {member.isActive ? "Disable" : "Enable"}
          </Button>
          {isSuperAdmin ? (
            <Button size="sm" variant="dangerGhost" onClick={() => onDelete(member)}>
              Remove
            </Button>
          ) : (
            <span className="w-[52px] text-center text-ink-muted">—</span>
          )}
        </div>
      </TD>
    </TR>
  );
});

const StudentRow = React.memo(function StudentRow({
  student,
  isSuperAdmin,
  onDelete,
}) {
  return (
    <TR className={!student.isActive ? "opacity-60" : ""}>
      <TD className="font-mono text-[13px] font-medium">{student.idNumber}</TD>
      <TD>{student.name}</TD>
      <TD className="text-ink-muted">{student.email}</TD>
      <TD className="tabular-nums">{student.batchYear}</TD>
      <TD><StatusBadge active={student.isActive} /></TD>
      <TD className="whitespace-nowrap text-[13px] text-ink-muted">
        {student.lastLogin
          ? new Date(student.lastLogin).toLocaleString()
          : "Never"}
      </TD>
      <TD>
        <div className="flex justify-end">
          {isSuperAdmin ? (
            <Button size="sm" variant="dangerGhost" onClick={() => onDelete(student)}>
              Delete
            </Button>
          ) : (
            <span className="w-[52px] text-center text-ink-muted">—</span>
          )}
        </div>
      </TD>
    </TR>
  );
});

const AdminDashboard = () => {
  const { userProfile, logout, getAuthToken } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = userProfile?.role === "super_admin";
  // Roster + staff management are admin/super_admin surfaces; coordinators
  // get overview/exams/reports/proctoring only (server enforces this too).
  const isRosterManager = ["admin", "super_admin"].includes(userProfile?.role);
  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [exams, setExams] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Staff state ───────────────────────────────────────────────────────
  const [staff, setStaff] = useState([]);
  const [staffSearch, setStaffSearch] = useState("");
  const [newStaff, setNewStaff] = useState({ name: "", email: "", role: "coordinator" });
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffMessage, setStaffMessage] = useState(null);
  const [createdTempPassword, setCreatedTempPassword] = useState(null);

  // ── Roster state ──────────────────────────────────────────────────────
  const [students, setStudents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [newStudent, setNewStudent] = useState({
    idNumber: "",
    name: "",
    batchYear: String(new Date().getFullYear()),
    password: "",
  });
  const [csvText, setCsvText] = useState("");
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterMessage, setRosterMessage] = useState(null);
  const [deleteBatchYear, setDeleteBatchYear] = useState("");
  const [deleteBatchConfirm, setDeleteBatchConfirm] = useState("");

  // ── Proctoring review state ───────────────────────────────────────────
  const [activeSessions, setActiveSessions] = useState([]);
  const [flaggedSessions, setFlaggedSessions] = useState([]);
  const [proctoringLoaded, setProctoringLoaded] = useState(false);
  const [reviewNotesDrafts, setReviewNotesDrafts] = useState({});
  const [proctoringMessage, setProctoringMessage] = useState(null);

  useEffect(() => {
    if (!["coordinator", "admin", "super_admin"].includes(userProfile?.role)) {
      navigate("/dashboard");
      return;
    }
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile]);

  useEffect(() => {
    if (activeTab === "staff") fetchStaff();
    if (activeTab === "students") {
      fetchStudents();
      fetchBatches();
    }
    if (activeTab === "proctoring") fetchProctoringData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, batchFilter]);

  const token = () => getAuthToken();

  const fetchDashboardData = async () => {
    try {
      const authToken = await token();
      const [statsData, examsData, reportsData] = await Promise.all([
        examService.getDashboardStats(authToken),
        examService.getAdminExams(authToken, 1, 50),
        examService.getReports(authToken).catch(() => ({ reports: [] })),
      ]);
      setStats(statsData.stats);
      setExams(examsData.exams);
      setReports(reportsData.reports);
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Staff management ───────────────────────────────────────────────
  const showStaffMessage = (type, text) => {
    setStaffMessage({ type, text });
    setTimeout(() => setStaffMessage(null), 6000);
  };

  const fetchStaff = async () => {
    try {
      const authToken = await token();
      const data = await adminService.listStaff(authToken, { search: staffSearchRef.current });
      setStaff(data.users || []);
    } catch (err) {
      showStaffMessage("error", err.response?.data?.message || "Failed to load staff");
    }
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    try {
      setStaffBusy(true);
      const authToken = await token();
      const data = await adminService.createStaff(authToken, newStaff);
      setCreatedTempPassword({ email: newStaff.email, password: data.tempPassword });
      setNewStaff({ name: "", email: "", role: "coordinator" });
      showStaffMessage("success", data.message);
      fetchStaff();
    } catch (err) {
      showStaffMessage("error", err.response?.data?.message || "Failed to create account");
    } finally {
      setStaffBusy(false);
    }
  };

  const handleToggleStaffStatus = async (member) => {
    try {
      const authToken = await token();
      await adminService.updateStaff(authToken, member._id, {
        isActive: !member.isActive,
      });
      setStaff(
        staff.map((s) =>
          s._id === member._id ? { ...s, isActive: !member.isActive } : s,
        ),
      );
    } catch (err) {
      showStaffMessage("error", err.response?.data?.message || "Update failed");
    }
  };

  const handleChangeStaffRole = async (member, role) => {
    try {
      const authToken = await token();
      await adminService.changeStaffRole(authToken, member._id, role);
      setStaff(staff.map((s) => (s._id === member._id ? { ...s, role } : s)));
    } catch (err) {
      showStaffMessage("error", err.response?.data?.message || "Tier change failed");
      fetchStaff();
    }
  };

  const handleDeleteStaff = async (member) => {
    if (
      !window.confirm(
        `Remove ${member.name} (${formatRoleName(member.role)})? Their exams and related data are deleted too. This cannot be undone.`,
      )
    )
      return;
    try {
      const authToken = await token();
      await adminService.deleteStaff(authToken, member._id);
      setStaff(staff.filter((s) => s._id !== member._id));
    } catch (err) {
      showStaffMessage("error", err.response?.data?.message || "Delete failed");
    }
  };

  // ─── Proctoring review ──────────────────────────────────────────────
  const showProctoringMessage = (type, text) => {
    setProctoringMessage({ type, text });
    setTimeout(() => setProctoringMessage(null), 6000);
  };

  const fetchProctoringData = async () => {
    try {
      const authToken = await token();
      const [activeData, flaggedData] = await Promise.all([
        examService.getActiveSessions(authToken),
        examService.getFlaggedSessions(authToken),
      ]);
      setActiveSessions(activeData.sessions || []);
      setFlaggedSessions(flaggedData.sessions || []);
    } catch (err) {
      console.error("Error loading proctoring data:", err);
      setProctoringLoaded(true);
    } finally {
      setProctoringLoaded(true);
    }
  };

  const handleReviewSession = async (session, reviewStatus) => {
    try {
      const authToken = await token();
      await examService.reviewSession(
        authToken,
        session._id,
        reviewStatus,
        reviewNotesDrafts[session._id] || "",
      );
      showProctoringMessage(
        "success",
        `Session marked ${reviewStatus.replace("_", " ")}`,
      );
      setReviewNotesDrafts((prev) => ({
        ...prev,
        [session._id]: "",
      }));
      fetchProctoringData();
    } catch (err) {
      showProctoringMessage(
        "error",
        err.response?.data?.message || "Review update failed",
      );
    }
  };

  const sessionStudentLabel = (session) =>
    session.studentId?.name ||
    (session.studentId?.deletedStudent ? "Deleted student" : "Unknown student");

  // ─── Student roster ─────────────────────────────────────────────────
  const showRosterMessage = (type, text) => {
    setRosterMessage({ type, text });
    setTimeout(() => setRosterMessage(null), 8000);
  };

  const staffSearchRef = React.useRef(staffSearch);
  staffSearchRef.current = staffSearch;
  const studentSearchRef = React.useRef(studentSearch);
  studentSearchRef.current = studentSearch;

  const fetchStudents = async (searchOverride) => {
    try {
      setRosterBusy(true);
      const authToken = await token();
      const data = await adminService.listStudents(authToken, {
        batchYear: batchFilter,
        search: searchOverride !== undefined ? searchOverride : studentSearchRef.current,
      });
      setStudents(data.students || []);
    } catch (err) {
      showRosterMessage("error", err.response?.data?.message || "Failed to load students");
    } finally {
      setRosterBusy(false);
    }
  };

  const fetchBatches = async () => {
    try {
      const authToken = await token();
      const data = await adminService.listBatches(authToken);
      setBatches(data.batches || []);
    } catch (err) {
      console.error("Error loading batches:", err);
    }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    try {
      setRosterBusy(true);
      const authToken = await token();
      const data = await adminService.addStudent(authToken, newStudent);
      showRosterMessage(
        "success",
        `${data.student.name} (${data.student.email}) added`,
      );
      setNewStudent((prev) => ({ ...prev, idNumber: "", name: "", password: "" }));
      fetchStudents();
      fetchBatches();
    } catch (err) {
      showRosterMessage("error", err.response?.data?.message || "Failed to add student");
    } finally {
      setRosterBusy(false);
    }
  };

  const handleImportCsv = async () => {
    if (!csvText.trim()) return;
    try {
      setRosterBusy(true);
      const authToken = await token();
      const data = await adminService.importStudents(authToken, csvText);
      const r = data.results;
      showRosterMessage(
        "info",
        `Import done — created ${r.created}, skipped duplicates ${r.skippedDuplicates}` +
          (r.errors.length ? `, ${r.errors.length} invalid rows` : ""),
      );
      setCsvText("");
      setShowCsvImport(false);
      fetchStudents();
      fetchBatches();
    } catch (err) {
      showRosterMessage("error", err.response?.data?.message || "Import failed");
    } finally {
      setRosterBusy(false);
    }
  };

  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(String(ev.target.result || ""));
    reader.readAsText(file);
  };

  const handleDeleteStudent = async (student) => {
    if (
      !window.confirm(
        `Hard-delete ${student.name} (${student.idNumber})?\n\nTheir submissions and proctoring records are permanently removed.`,
      )
    )
      return;
    try {
      const authToken = await token();
      await adminService.deleteStudent(authToken, student._id);
      setStudents(students.filter((s) => s._id !== student._id));
      fetchBatches();
    } catch (err) {
      showRosterMessage("error", err.response?.data?.message || "Delete failed");
    }
  };

  const handleDeleteBatch = async () => {
    const year = parseInt(deleteBatchYear);
    if (!year) {
      showRosterMessage("error", "Select the batch year you want to delete.");
      return;
    }
    if (deleteBatchConfirm.trim() !== String(year)) {
      showRosterMessage(
        "error",
        `Type "${year}" exactly to confirm this irreversible deletion.`,
      );
      return;
    }
    if (
      !window.confirm(
        `Permanently delete EVERY student in batch ${year}, including all their submissions and proctoring records?`,
      )
    )
      return;
    try {
      setRosterBusy(true);
      const authToken = await token();
      const data = await adminService.deleteBatch(
        authToken,
        year,
        deleteBatchConfirm.trim(),
      );
      showRosterMessage("success", data.message);
      setDeleteBatchYear("");
      setDeleteBatchConfirm("");
      fetchStudents();
      fetchBatches();
    } catch (err) {
      showRosterMessage("error", err.response?.data?.message || "Batch deletion failed");
    } finally {
      setRosterBusy(false);
    }
  };

  // ─── Exams / reports / overview (existing behavior) ──────────────────
  const handleDeleteExam = async (examId) => {
    if (!window.confirm("Are you sure you want to delete this exam?")) return;
    try {
      const authToken = await token();
      await examService.deleteExamAdmin(authToken, examId);
      setExams(exams.filter((e) => e._id !== examId));
    } catch (err) {
      alert("Error deleting exam: " + err.message);
    }
  };

  const generateReport = async (type) => {
    try {
      const authToken = await token();
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      await examService.generateReport(
        authToken,
        type,
        startDate.toISOString(),
        endDate.toISOString(),
      );
      const reportsData = await examService.getReports(authToken);
      setReports(reportsData.reports);
    } catch (err) {
      alert("Error generating report: " + err.message);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // Debounced client-side staff filtering; roster search triggers a debounced server fetch.
  const debouncedStaffSearch = useDebouncedValue(staffSearch, 300);
  const filteredStaff = useMemo(() => {
    const q = debouncedStaffSearch.toLowerCase();
    return staff.filter(
      (m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [staff, debouncedStaffSearch]);
  const staffPage = usePagedData(filteredStaff, PAGE_SIZE, debouncedStaffSearch);

  const debouncedStudentFetch = useDebouncedValue(studentSearch, 450);
  useEffect(() => {
    if (activeTab !== "students") return;
    if (debouncedStudentFetch === studentSearchRef.current) {
      fetchStudents(debouncedStudentFetch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedStudentFetch, batchFilter, activeTab]);

  const studentPage = usePagedData(students, PAGE_SIZE);

  // ─── Render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout maxWidth="max-w-7xl">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
        </div>
        <div className="mt-6 space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </AppLayout>
    );
  }

  const inlineMessage = (msg) =>
    msg ? (
      <Alert variant={msg.type === "success" ? "success" : msg.type === "error" ? "error" : "info"} className="mb-4">
        {msg.text}
      </Alert>
    ) : null;

  return (
    <AppLayout maxWidth="max-w-7xl">
      <PageHeader
        title="Administration Console"
        subtitle={`CSE Placements Training · Welcome, ${userProfile?.name}`}
        actions={
          <>
            <Badge variant={userProfile?.role === "super_admin" ? "accent" : "neutral"}>
              {formatRoleName(userProfile?.role)}
            </Badge>
            <Button variant="secondary" onClick={handleLogout}>
              Logout
            </Button>
          </>
        }
      />

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="Admin sections" className="mt-5 overflow-x-auto border-b border-line">
        <nav className="-mb-px flex gap-1">
          {[
            ["overview", "Overview"],
            ...(isRosterManager ? [["staff", "Staff"], ["students", "Students"]] : []),
            ["exams", `Exams (${exams.length})`],
            ["proctoring", "Proctoring"],
            ["reports", "Reports"],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              className={`${TAB_BASE} ${activeTab === key ? TAB_ACTIVE : TAB_IDLE}`}
              onClick={() => setActiveTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="py-6">
        {/* ═══ OVERVIEW ═══════════════════════════════════════ */}
        {activeTab === "overview" && stats && (
          <section>
            <h2 className="text-[18px] font-semibold text-ink">System Overview</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              {stats.totalUsers != null && (
                <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
                  <dd className="text-[30px] font-bold leading-none tracking-tight text-ink">{stats.totalUsers}</dd>
                  <dt className="mt-1.5 text-sm font-medium text-ink">Total Accounts</dt>
                  <p className="mt-2 border-t border-line pt-2 text-[13px] leading-relaxed text-ink-muted">
                    Students: {stats.totalStudents}
                    <br />
                    Coordinators: {stats.totalCoordinators ?? stats.totalTNPCAdmins ?? 0}
                  </p>
                </div>
              )}
              <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
                <dd className="text-[30px] font-bold leading-none tracking-tight text-ink">{stats.totalExams}</dd>
                <dt className="mt-1.5 text-sm font-medium text-ink">Exams</dt>
                <p className="mt-2 border-t border-line pt-2 text-[13px] text-ink-muted">Active: {stats.activeExams}</p>
              </div>
              <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
                <dd className="text-[30px] font-bold leading-none tracking-tight text-ink">{stats.totalSubmissions}</dd>
                <dt className="mt-1.5 text-sm font-medium text-ink">Submissions</dt>
                <p className="mt-2 border-t border-line pt-2 text-[13px] leading-relaxed text-ink-muted">
                  Today: {stats.recentSubmissions}
                  <br />
                  <span className={stats.flaggedSubmissions > 0 ? "font-medium text-danger" : ""}>
                    Flagged: {stats.flaggedSubmissions}
                  </span>
                </p>
              </div>
            </dl>

            <Card className="mt-6 max-w-xl">
              <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
              <CardBody className="flex flex-wrap gap-2.5 pt-0">
                {isRosterManager && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setActiveTab("students")}>
                      Manage Student Roster
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setActiveTab("staff")}>
                      Manage Staff Accounts
                    </Button>
                  </>
                )}
                <Button size="sm" variant="secondary" onClick={() => generateReport("system_usage")}>
                  Generate System Report
                </Button>
              </CardBody>
            </Card>
          </section>
        )}

        {/* ═══ STAFF ══════════════════════════════════════════ */}
        {activeTab === "staff" && (
          <section>
            <h2 className="text-[18px] font-semibold text-ink">Staff Accounts</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
              {isSuperAdmin
                ? "As super admin you can create, manage, and remove admin and coordinator accounts."
                : "You can create and manage coordinator accounts. Account removal is super-admin-only — deactivate instead. Higher-tier changes need a super admin."}
            </p>

            {inlineMessage(staffMessage)}

            {createdTempPassword && (
              <Alert variant="success" title={`Account created for ${createdTempPassword.email}`} className="mb-4" onDismiss={() => setCreatedTempPassword(null)}>
                <p className="mt-0.5">
                  Temporary password:{" "}
                  <code className="rounded-sm bg-white px-1.5 py-0.5 font-mono text-[13px] font-semibold text-ink ring-1 ring-inset ring-line">
                    {createdTempPassword.password}
                  </code>
                </p>
                <small className="mt-1 block opacity-80">
                  Shown only once — hand it to the staff member securely. They should change it after first sign-in.
                </small>
              </Alert>
            )}

            <form onSubmit={handleCreateStaff} className="mt-4 flex flex-col gap-2.5 rounded-md border border-line bg-surface p-4 shadow-sm lg:flex-row lg:items-end">
              <Input label="Full name" type="text" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} required />
              <Input label="Email" type="email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} required />
              <Select label="Tier" value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}>
                <option value="coordinator">Coordinator</option>
                {isSuperAdmin && <option value="admin">Admin</option>}
              </Select>
              <div className="lg:pb-0.5">
                <Button type="submit" disabled={staffBusy}>
                  {staffBusy ? "Creating…" : "Create Account"}
                </Button>
              </div>
            </form>

            <div className="mt-4 flex items-center gap-2.5">
              <input
                type="text"
                placeholder="Search staff by name or email…"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                aria-label="Search staff"
                className="h-9 w-full max-w-xs rounded-sm border border-line bg-surface px-3 text-sm text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
              <Button size="sm" variant="secondary" onClick={fetchStaff}>Search server-side</Button>
            </div>

            <div className="mt-4">
              <Table>
                <THead>
                  <TRHead>
                    <TH>Name</TH>
                    <TH>Email</TH>
                    <TH>Tier</TH>
                    <TH>Status</TH>
                    <TH>Joined</TH>
                    <TH className="text-right">Actions</TH>
                  </TRHead>
                </THead>
                <TBody>
                  {staffPage.pagedItems.map((member) => (
                    <StaffRow
                      key={member._id}
                      member={member}
                      isSelf={member._id === userProfile?._id}
                      isSuperAdmin={isSuperAdmin}
                      onChangeRole={handleChangeStaffRole}
                      onToggleStatus={handleToggleStaffStatus}
                      onDelete={handleDeleteStaff}
                    />
                  ))}
                  {filteredStaff.length === 0 && (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-sm text-ink-muted">
                        No staff accounts yet.
                      </td>
                    </tr>
                  )}
                </TBody>
              </Table>
              <Pagination page={staffPage.page} pageCount={staffPage.pageCount} onPageChange={staffPage.setPage} />
            </div>
          </section>
        )}

        {/* ═══ STUDENTS ═══════════════════════════════════════ */}
        {activeTab === "students" && (
          <section>
            <h2 className="text-[18px] font-semibold text-ink">Student Roster</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
              Students sign in with their ID number (or college email) plus their
              own college exam-cell password — the same one they already use for
              semester results. Every account must be created with that password.
            </p>

            {inlineMessage(rosterMessage)}

            {/* Add single student */}
            <form onSubmit={handleAddStudent} className="mt-4 flex flex-col gap-2.5 rounded-md border border-line bg-surface p-4 shadow-sm lg:flex-row lg:items-end">
              <Input label="ID number" placeholder="Any format, e.g. s210574" type="text" value={newStudent.idNumber} onChange={(e) => setNewStudent({ ...newStudent, idNumber: e.target.value })} required />
              <Input label="Full name" placeholder="Full name" type="text" value={newStudent.name} onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })} required />
              <Select label="Batch year" value={newStudent.batchYear} onChange={(e) => setNewStudent({ ...newStudent, batchYear: e.target.value })}>
                {BATCH_YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
              <Input label="Exam-cell password" placeholder="Their college password" type="text" value={newStudent.password} onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })} required />
              <div className="shrink-0">
                <Button type="submit" disabled={rosterBusy}>
                  Add Student
                </Button>
              </div>
            </form>

            {/* Bulk import toggle */}
            <div className="mt-4 flex items-center gap-3">
              <Button size="sm" variant="secondary" onClick={() => setShowCsvImport(!showCsvImport)}>
                {showCsvImport ? "Hide CSV import" : "Bulk import (CSV)"}
              </Button>
              <span className="text-[13px] text-ink-muted">
                CSV columns (all required): ID number, Name, Batch year, Exam-cell password — use each student's existing college password
              </span>
            </div>

            {showCsvImport && (
              <div className="mt-3 space-y-2.5 rounded-md border border-line bg-surface p-4 shadow-sm">
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  One student per line, comma-separated:{" "}
                  <code className="rounded-sm bg-stone-100 px-1 py-0.5 font-mono text-[12px] text-ink">ID number, Name, Batch year, Exam-cell password</code>.
                  The password is the one the college already issued for results — type it exactly as issued.
                  A header row is optional; rows missing a password are rejected.
                </p>
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={handleCsvFile}
                  aria-label="Choose CSV file"
                  className="block w-full text-sm text-ink-muted file:mr-3 file:h-8 file:cursor-pointer file:rounded-sm file:border-0 file:bg-primary-light file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-stone-200"
                />
                <textarea
                  rows={6}
                  placeholder={"idnumber,name,batch,examcellpassword\ns210574,Anjali R,2025,aB3x9\no210231,Ravi K,2025,Qw7rt"}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  aria-label="Or paste CSV rows"
                  className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                />
                <Button onClick={handleImportCsv} disabled={rosterBusy || !csvText.trim()}>
                  {rosterBusy ? "Importing…" : "Import Rows"}
                </Button>
              </div>
            )}

            {/* Filters */}
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Search by name or ID…"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchStudents()}
                aria-label="Search students"
                className="h-9 w-full max-w-xs rounded-sm border border-line bg-surface px-3 text-sm text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                aria-label="Filter by batch"
                className="h-9 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              >
                <option value="">All batches</option>
                {batches.map((b) => (
                  <option key={b._id ?? "none"} value={b._id ?? ""}>
                    Batch {b._id ?? "—"} ({b.count})
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={() => fetchStudents()}>Apply</Button>
              {rosterBusy && <span className="text-[13px] text-ink-muted">Loading…</span>}
            </div>

            {/* Danger zone: delete whole batch (super_admin only) */}
            {isSuperAdmin ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50/50 p-4">
                <h3 className="text-sm font-semibold text-danger">Danger Zone — Delete Entire Batch</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                  Irreversible: removes every student in the batch along with their submissions and proctoring records.
                  Type the batch year to confirm.
                </p>
                <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                  <select
                    value={deleteBatchYear}
                    onChange={(e) => setDeleteBatchYear(e.target.value)}
                    aria-label="Select batch to delete"
                    className="h-9 rounded-sm border border-red-200 bg-surface px-2.5 text-sm text-ink focus:border-danger focus:outline-none focus:ring-2 focus:ring-danger/25"
                  >
                    <option value="">Select batch…</option>
                    {batches.map((b) => (
                      <option key={b._id ?? "none"} value={b._id ?? ""}>
                        Batch {b._id} ({b.count})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder={`Type "${deleteBatchYear || "year"}" to confirm`}
                    value={deleteBatchConfirm}
                    onChange={(e) => setDeleteBatchConfirm(e.target.value)}
                    aria-label="Type batch year to confirm deletion"
                    className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink placeholder:text-stone-400 focus:border-danger focus:outline-none focus:ring-2 focus:ring-danger/25 sm:max-w-xs"
                  />
                  <Button size="sm" variant="danger" onClick={handleDeleteBatch}
                    disabled={!deleteBatchYear || deleteBatchConfirm.trim() !== deleteBatchYear || rosterBusy}>
                    Delete Batch Forever
                  </Button>
                </div>
              </div>
            ) : (
              <Alert variant="info" className="mt-4">
                Student/batch deletion is restricted to super admins. Ask your super admin if a batch must be removed.
              </Alert>
            )}

            {/* Roster table */}
            <div className="mt-4">
              <Table>
                <THead>
                  <TRHead>
                    <TH>ID Number</TH>
                    <TH>Name</TH>
                    <TH>Email (derived)</TH>
                    <TH>Batch</TH>
                    <TH>Status</TH>
                    <TH>Last Login</TH>
                    <TH className="text-right">Actions</TH>
                  </TRHead>
                </THead>
                <TBody>
                  {studentPage.pagedItems.map((student) => (
                    <StudentRow
                      key={student._id}
                      student={student}
                      isSuperAdmin={isSuperAdmin}
                      onDelete={handleDeleteStudent}
                    />
                  ))}
                  {students.length === 0 && (
                    <tr>
                      <td colSpan="7" className="px-4 py-8 text-center text-sm text-ink-muted">
                        No students match. Add some above.
                      </td>
                    </tr>
                  )}
                </TBody>
              </Table>
              <Pagination page={studentPage.page} pageCount={studentPage.pageCount} onPageChange={studentPage.setPage} />
            </div>
          </section>
        )}

        {/* ═══ PROCTORING ═════════════════════════════════════ */}
        {activeTab === "proctoring" && (
          <section>
            <h2 className="text-[18px] font-semibold text-ink">Proctoring Review</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
              Live sessions, flagged activity, and trust scores across all proctored exams.
              Review decisions are recorded on each session.
            </p>

            {inlineMessage(proctoringMessage)}

            <Button size="sm" variant="secondary" className="mt-3" onClick={fetchProctoringData} disabled={!proctoringLoaded}>
              Refresh
            </Button>

            <h3 className="mb-2.5 mt-6 text-[15px] font-semibold text-ink">Active Sessions ({activeSessions.length})</h3>
            {activeSessions.length === 0 ? (
              <p className="text-[13px] italic text-ink-muted">No exams are being proctored right now.</p>
            ) : (
              <Table>
                <THead>
                  <TRHead>
                    <TH>Student</TH>
                    <TH>Exam</TH>
                    <TH>Started</TH>
                    <TH>Trust Score</TH>
                    <TH>Events</TH>
                  </TRHead>
                </THead>
                <TBody>
                  {activeSessions.map((session) => (
                    <TR key={session._id}>
                      <TD>{sessionStudentLabel(session)}</TD>
                      <TD className="max-w-[220px] truncate">{session.examId?.title || "—"}</TD>
                      <TD className="whitespace-nowrap text-[13px] text-ink-muted">
                        {session.startedAt ? new Date(session.startedAt).toLocaleString() : "—"}
                      </TD>
                      <TD>
                        <span className={`font-semibold tabular-nums ${trustToneClass(session.trustScore ?? 100)}`}>
                          {session.trustScore ?? 100}%
                        </span>
                      </TD>
                      <TD className="tabular-nums">{session.events?.length ?? 0}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            <h3 className="mb-2.5 mt-7 text-[15px] font-semibold text-ink">Flagged / Pending Review ({flaggedSessions.length})</h3>
            {flaggedSessions.length === 0 ? (
              <p className="text-[13px] italic text-ink-muted">Nothing is awaiting review — all clear.</p>
            ) : (
              <Table>
                <THead>
                  <TRHead>
                    <TH>Student</TH>
                    <TH>Exam</TH>
                    <TH>Status</TH>
                    <TH>Review</TH>
                    <TH>Trust Score</TH>
                    <TH>Events</TH>
                    <TH>Decision</TH>
                  </TRHead>
                </THead>
                <TBody>
                  {flaggedSessions.map((session) => (
                    <TR key={session._id}>
                      <TD>{sessionStudentLabel(session)}</TD>
                      <TD className="max-w-[180px] truncate">{session.examId?.title || "—"}</TD>
                      <TD><Badge variant="neutral">{session.status}</Badge></TD>
                      <TD><Badge variant={session.reviewStatus === "violation_confirmed" ? "danger" : session.reviewStatus ? "success" : "warning"}>
                        {session.reviewStatus?.replace(/_/g, " ") || "pending"}
                      </Badge></TD>
                      <TD>
                        <span className={`font-semibold tabular-nums ${trustToneClass(session.trustScore ?? 100)}`}>
                          {session.trustScore ?? 100}%
                        </span>
                      </TD>
                      <TD className="tabular-nums">{session.events?.length ?? 0}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Review notes (optional)"
                            value={reviewNotesDrafts[session._id] || ""}
                            onChange={(e) =>
                              setReviewNotesDrafts((prev) => ({
                                ...prev,
                                [session._id]: e.target.value,
                              }))
                            }
                            aria-label={`Review notes for ${sessionStudentLabel(session)}`}
                            className="h-8 w-44 rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                          />
                          <Button size="sm" variant="secondary" onClick={() => handleReviewSession(session, "cleared")}>
                            Clear
                          </Button>
                          <Button size="sm" variant="dangerGhost" onClick={() => handleReviewSession(session, "violation_confirmed")}>
                            Confirm Violation
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        )}

        {/* ═══ EXAMS ══════════════════════════════════════════ */}
        {activeTab === "exams" && (
          <section>
            <h2 className="text-[18px] font-semibold text-ink">All Exams</h2>
            <div className="mt-4">
              <Table>
                <THead>
                  <TRHead>
                    <TH>Title</TH>
                    <TH>Created By</TH>
                    <TH>Status</TH>
                    <TH>Submissions</TH>
                    <TH>Created</TH>
                    <TH className="text-right">Actions</TH>
                  </TRHead>
                </THead>
                <TBody>
                  {exams.map((exam) => {
                    const active = exam.isActive && new Date(exam.endTime) > new Date();
                    return (
                      <TR key={exam._id}>
                        <TD className="max-w-[240px] truncate font-medium">{exam.title}</TD>
                        <TD className="text-ink-muted">{exam.teacherId?.name || "Unknown"}</TD>
                        <TD>
                          <Badge dot variant={active ? "success" : "neutral"}>
                            {active ? "Active" : "Ended"}
                          </Badge>
                        </TD>
                        <TD className="tabular-nums">{exam.totalSubmissions || 0}</TD>
                        <TD className="whitespace-nowrap text-[13px] text-ink-muted">
                          {new Date(exam.createdAt).toLocaleDateString()}
                        </TD>
                        <TD>
                          <div className="flex justify-end">
                            {isSuperAdmin ? (
                              <Button size="sm" variant="dangerGhost" onClick={() => handleDeleteExam(exam._id)}>
                                Delete
                              </Button>
                            ) : (
                              <span className="w-[52px] text-center text-ink-muted">—</span>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </section>
        )}

        {/* ═══ REPORTS ════════════════════════════════════════ */}
        {activeTab === "reports" && (
          <section>
            <h2 className="text-[18px] font-semibold text-ink">Reports</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {[
                ["exam_analytics", "Exam Analytics"],
                ["student_performance", "Student Performance"],
                ["proctoring_summary", "Proctoring Summary"],
                ["system_usage", "System Usage"],
              ].map(([type, label]) => (
                <Button key={type} size="sm" variant="secondary" onClick={() => generateReport(type)}>
                  {label}
                </Button>
              ))}
            </div>

            <h3 className="mb-2.5 mt-7 text-[15px] font-semibold text-ink">Generated Reports</h3>
            {reports.length === 0 ? (
              <div className="rounded-md border border-line bg-surface shadow-sm">
                <EmptyState
                  icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  }
                  title="No reports generated yet"
                  description="Generate a report above to see it listed here."
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TRHead>
                    <TH>Report Type</TH>
                    <TH>Date Range</TH>
                    <TH>Generated</TH>
                    <TH>Status</TH>
                  </TRHead>
                </THead>
                <TBody>
                  {reports.map((report) => (
                    <TR key={report._id}>
                      <TD className="capitalize">
                        {report.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                      </TD>
                      <TD className="whitespace-nowrap text-[13px] text-ink-muted">
                        {new Date(report.startDate).toLocaleDateString()} - {new Date(report.endDate).toLocaleDateString()}
                      </TD>
                      <TD className="whitespace-nowrap text-[13px] text-ink-muted">
                        {new Date(report.createdAt).toLocaleString()}
                      </TD>
                      <TD>
                        <Badge variant={report.status === "completed" ? "success" : report.status === "failed" ? "danger" : "warning"}>
                          {report.status}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
};

export default AdminDashboard;
