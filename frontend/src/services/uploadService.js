import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const uploadService = {
  uploadImage: async (token, file) => {
    if (!token || token === "null" || token === "undefined") {
      throw new Error("No auth token available - please sign in again.");
    }
    const formData = new FormData();
    formData.append("image", file);
    const response = await axios.post(`${API_URL}/uploads/image`, formData, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60000,
    });
    return response.data.url;
  },
};
