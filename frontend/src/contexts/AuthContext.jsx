import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import axios from 'axios';
import { STAFF_ROLES } from '../utils/roles';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const STUDENT_TOKEN_KEY = 'modugo_student_token';
const STUDENT_PROFILE_KEY = 'modugo_student_profile';

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  // Students have no Firebase identity — their session is a backend JWT.
  const [studentToken, setStudentToken] = useState(
    () => localStorage.getItem(STUDENT_TOKEN_KEY) || null,
  );
  const [loading, setLoading] = useState(true);
  const authActionRef = React.useRef(false);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

  const applyProfile = (profile) => {
    setUserProfile(profile);
    return profile;
  };

  // Works for both Firebase staff tokens and roster-student JWTs; the
  // backend middleware accepts either.
  const fetchUserProfile = async (token) => {
    const response = await axios.get(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return applyProfile(response.data.user);
  };

  // ── REQ-19 helpers (staff login lockout UX) ───────────────────────────
  const checkLoginLock = async (email) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login-status`, { email });
      return response.data;
    } catch (error) {
      if (error.response?.status === 423) {
        return error.response.data;
      }
      throw error;
    }
  };

  const recordLoginFailure = async (email) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login-failure`, { email });
      return response.data;
    } catch (error) {
      if (error.response?.status === 423) {
        return error.response.data;
      }
      return null;
    }
  };

  const recordLoginSuccess = async (token) => {
    try {
      await axios.post(`${API_URL}/auth/login-success`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error('Error recording login success:', error);
    }
  };

  // ── Student roster login (ID/email + own exam-cell password) ────────
  const studentLogin = async (identifier, password) => {
    const response = await axios.post(`${API_URL}/auth/student-login`, {
      identifier,
      password,
    });
    const { token, user } = response.data;
    localStorage.setItem(STUDENT_TOKEN_KEY, token);
    localStorage.setItem(STUDENT_PROFILE_KEY, JSON.stringify(user));
    setStudentToken(token);
    return applyProfile(user);
  };

  // ── Staff login (Firebase email/password) ─────────────────────────────
  const login = async (email, password) => {
    clearStudentSession(); // never hold both session types at once
    const lockStatus = await checkLoginLock(email);
    if (lockStatus.locked) {
      const error = new Error(lockStatus.message);
      error.lockData = lockStatus;
      throw error;
    }

    authActionRef.current = true;
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      await recordLoginSuccess(token);

      const profile = await fetchUserProfile(token);

      if (!STAFF_ROLES.includes(profile.role)) {
        await signOut(auth);
        setUserProfile(null);
        throw new Error(
          'This account is not a staff account. Students must sign in with their ID number on the Student tab.',
        );
      }

      return userCredential;
    } catch (firebaseError) {
      if (
        firebaseError.code === 'auth/wrong-password' ||
        firebaseError.code === 'auth/invalid-credential' ||
        firebaseError.code === 'auth/user-not-found' ||
        firebaseError.code === 'auth/invalid-email'
      ) {
        const failureResult = await recordLoginFailure(email);
        if (failureResult?.locked) {
          const lockError = new Error(failureResult.message);
          lockError.lockData = failureResult;
          throw lockError;
        }
        if (failureResult?.remainingAttempts !== undefined) {
          firebaseError.remainingAttempts = failureResult.remainingAttempts;
        }
      }
      throw firebaseError;
    } finally {
      authActionRef.current = false;
    }
  };

  const clearStudentSession = () => {
    localStorage.removeItem(STUDENT_TOKEN_KEY);
    localStorage.removeItem(STUDENT_PROFILE_KEY);
    setStudentToken(null);
  };

  const logout = async () => {
    clearStudentSession();
    setUserProfile(null);
    if (currentUser) {
      return signOut(auth);
    }
    return Promise.resolve();
  };

  const getAuthToken = async () => {
    if (studentToken) {
      return studentToken;
    }
    if (currentUser) {
      return await currentUser.getIdToken();
    }
    return null;
  };

  useEffect(() => {
    // Rehydrate a stored student session immediately (no Firebase event will
    // fire for roster students).
    if (studentToken && !userProfile) {
      try {
        const cached = JSON.parse(
          localStorage.getItem(STUDENT_PROFILE_KEY) || 'null',
        );
        if (cached) {
          applyProfile(cached);
        }
        // Refresh the profile in the background so role/status stays true to
        // the server (e.g. account deactivated mid-session).
        axios
          .get(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${studentToken}` },
          })
          .then((res) => applyProfile(res.data.user))
          .catch(() => {
            clearStudentSession();
            setUserProfile(null);
          });
      } catch {
        clearStudentSession();
      }
      setLoading(false);
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        if (!authActionRef.current) {
          try {
            const token = await user.getIdToken();
            await fetchUserProfile(token);
          } catch (error) {
            console.error('Error fetching user profile:', error);
            if (error.response?.status === 404 || error.response?.status === 403 || error.response?.status === 401) {
              // Profile missing or not provisioned. Sign out — accounts are
              // created by administrators, never self-registered.
              console.error('Staff profile not provisioned. Signing out.');
              signOut(auth);
              setUserProfile(null);
            }
          }
        }
      } else if (!studentToken) {
        setUserProfile(null);
      }

      if (!authActionRef.current) {
        setLoading(false);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    currentUser,
    userProfile,
    studentToken,
    isAuthenticated: Boolean(currentUser || studentToken),
    studentLogin,
    login,
    logout,
    getAuthToken,
    checkLoginLock,
    refreshUserProfile: fetchUserProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
