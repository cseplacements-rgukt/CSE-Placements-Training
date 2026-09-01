import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const authHeader = (token) => {
  if (!token || token === "null" || token === "undefined") {
    throw new Error("No auth token available - please sign in again.");
  }
  return { headers: { Authorization: `Bearer ${token}` } };
};

// Staff account provisioning + student roster management.
// Backend routes: /api/staff and /api/students (admin/super_admin only).
export const adminService = {
  // ─── Staff ──────────────────────────────────────────────────────────────
  listStaff: async (token, { role = "", search = "" } = {}) => {
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    if (search) params.set("search", search);
    const response = await axios.get(
      `${API_URL}/staff/users?${params.toString()}`,
      authHeader(token),
    );
    return response.data;
  },

  createStaff: async (token, { name, email, role, password }) => {
    const response = await axios.post(
      `${API_URL}/staff`,
      { name, email, role, password },
      authHeader(token),
    );
    return response.data;
  },

  updateStaff: async (token, userId, payload) => {
    const response = await axios.put(
      `${API_URL}/staff/${userId}`,
      payload,
      authHeader(token),
    );
    return response.data;
  },

  changeStaffRole: async (token, userId, role) => {
    const response = await axios.put(
      `${API_URL}/staff/${userId}/role`,
      { role },
      authHeader(token),
    );
    return response.data;
  },

  deleteStaff: async (token, userId) => {
    const response = await axios.delete(
      `${API_URL}/staff/${userId}`,
      authHeader(token),
    );
    return response.data;
  },

  resetStaffPassword: async (token, userId, password) => {
    const response = await axios.put(
      `${API_URL}/staff/${userId}/password`,
      { password },
      authHeader(token),
    );
    return response.data;
  },

  // ─── Student roster ───────────────────────────────────────────────────
  listStudents: async (token, { batchYear = "", search = "", page = 1, limit = 50 } = {}) => {
    const params = new URLSearchParams({ page, limit });
    if (batchYear) params.set("batchYear", batchYear);
    if (search) params.set("search", search);
    const response = await axios.get(
      `${API_URL}/students?${params.toString()}`,
      authHeader(token),
    );
    return response.data;
  },

  listBatches: async (token) => {
    const response = await axios.get(
      `${API_URL}/students/batches`,
      authHeader(token),
    );
    return response.data;
  },

  addStudent: async (token, { idNumber, name, batchYear, password }) => {
    const response = await axios.post(
      `${API_URL}/students`,
      { idNumber, name, batchYear, password },
      authHeader(token),
    );
    return response.data;
  },

  importStudents: async (token, csvText) => {
    const response = await axios.post(
      `${API_URL}/students/import`,
      { csv: csvText },
      authHeader(token),
    );
    return response.data;
  },

  deleteStudent: async (token, studentId) => {
    const response = await axios.delete(
      `${API_URL}/students/${studentId}`,
      authHeader(token),
    );
    return response.data;
  },

  deleteBatch: async (token, batchYear, confirmBatchYear) => {
    const response = await axios.post(
      `${API_URL}/students/delete-batch`,
      { batchYear, confirmBatchYear },
      authHeader(token),
    );
    return response.data;
  },
};
