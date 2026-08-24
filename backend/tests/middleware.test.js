// ═══════════════════════════════════════════════════════════════════
// MIDDLEWARE TESTS
// ═══════════════════════════════════════════════════════════════════

// Mock firebase-admin at the top level before any require
const mockVerifyIdToken = jest.fn();
jest.mock("../config/firebase", () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));

const verifyFirebaseToken = require("../middleware/auth");

describe("Auth Middleware", () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockVerifyIdToken.mockReset();

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  // ─── Error Handling: Missing token ─────────────────────────────
  describe("Error Handling: Missing or invalid token", () => {
    test("should return 401 when no authorization header", async () => {
      mockReq = { headers: {} };

      await verifyFirebaseToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ message: "No token provided" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 403 when token verification fails", async () => {
      mockVerifyIdToken.mockRejectedValue(new Error("Invalid token"));

      mockReq = { headers: { authorization: "Bearer invalid_token" } };

      await verifyFirebaseToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ message: "Invalid token" });
      expect(mockNext).not.toHaveBeenCalled();
    });

  });

  // ─── Logic Checks: Successful token verification ──────────────
  describe("Logic Checks: Successful verification", () => {
    test("should call next() and set req.user on valid token", async () => {
      const decodedToken = { uid: "test_uid", email: "test@test.com" };
      mockVerifyIdToken.mockResolvedValue(decodedToken);

      mockReq = { headers: { authorization: "Bearer valid_token" } };

      await verifyFirebaseToken(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(decodedToken);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    test("should extract token correctly from Bearer format", async () => {
      const decodedToken = { uid: "uid_123" };
      mockVerifyIdToken.mockResolvedValue(decodedToken);

      mockReq = { headers: { authorization: "Bearer my_actual_token_value" } };

      await verifyFirebaseToken(mockReq, mockRes, mockNext);

      expect(mockVerifyIdToken).toHaveBeenCalledWith("my_actual_token_value");
    });
  });
});

describe("Rate Limiter Configuration", () => {
  let rateLimiter;

  beforeEach(() => {
    jest.resetModules();
    rateLimiter = require("../middleware/rateLimiter");
  });

  // ─── OO Checks: Exported objects ──────────────────────────────
  describe("OO Checks: Module exports", () => {
    test("should export apiLimiter as a function", () => {
      expect(rateLimiter.apiLimiter).toBeDefined();
      expect(typeof rateLimiter.apiLimiter).toBe("function");
    });

  });
});
