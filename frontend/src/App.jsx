import React, { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { EXAM_TEAM_ROLES } from "./utils/roles";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import { LoadingScreen } from "./components/ui/Spinner";

const TakeExam = lazy(() => import("./pages/TakeExam"));
const MySubmissions = lazy(() => import("./pages/MySubmissions"));
const CreateExam = lazy(() => import("./pages/CreateExam"));
const ExamDraftWorkspace = lazy(() => import("./pages/ExamDraftWorkspace"));
const ExamSubmissions = lazy(() => import("./pages/ExamSubmissions"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));

const PrivateRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" />;
};

const PublicRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return !isAuthenticated ? children : <Navigate to="/dashboard" />;
};

// Staff tiers: coordinator (training team) < admin < super_admin.
const RoleRoute = ({ children, allowedRoles }) => {
  const { isAuthenticated, userProfile } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (!userProfile) {
    return <LoadingScreen message="Loading…" />;
  }

  if (!allowedRoles.includes(userProfile.role)) {
    return <Navigate to="/dashboard" />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen message="Loading…" />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" />} />
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <Dashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/create-exam"
              element={
                <RoleRoute allowedRoles={EXAM_TEAM_ROLES}>
                  <CreateExam />
                </RoleRoute>
              }
            />
            <Route
              path="/edit-exam/:examId"
              element={
                <RoleRoute allowedRoles={EXAM_TEAM_ROLES}>
                  <ExamDraftWorkspace />
                </RoleRoute>
              }
            />
            <Route
              path="/take-exam/:examId"
              element={
                <RoleRoute allowedRoles={["student"]}>
                  <TakeExam />
                </RoleRoute>
              }
            />
            <Route
              path="/my-submissions"
              element={
                <RoleRoute allowedRoles={["student"]}>
                  <MySubmissions />
                </RoleRoute>
              }
            />
            <Route
              path="/exam-submissions/:examId"
              element={
                <RoleRoute allowedRoles={EXAM_TEAM_ROLES}>
                  <ExamSubmissions />
                </RoleRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <RoleRoute allowedRoles={EXAM_TEAM_ROLES}>
                  <AdminDashboard />
                </RoleRoute>
              }
            />
            {/* Catch all route */}
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

export default App;
