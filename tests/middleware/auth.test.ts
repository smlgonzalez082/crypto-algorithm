import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { authenticateToken, initCognitoVerifier, optionalAuth } from '../../src/middleware/auth.js';

// Mock aws-jwt-verify
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({
      verify: jest.fn(),
    })),
  },
}));

jest.mock('../../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Authentication Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    mockReq = {
      headers: {},
      path: '/api/test',
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn() as jest.MockedFunction<NextFunction>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initCognitoVerifier()', () => {
    it('should initialize verifier with valid credentials', () => {
      expect(() => {
        initCognitoVerifier('us-east-1_test123', 'test-client-id');
      }).not.toThrow();
    });

    it('should warn when credentials not provided', () => {
      initCognitoVerifier('', '');
      // Should log warning but not throw
    });
  });

  describe('authenticateToken()', () => {
    it('should pass through when verifier not initialized', async () => {
      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 401 when no authorization header', async () => {
      // Initialize with real credentials to enable auth
      initCognitoVerifier('us-east-1_test123', 'test-client-id');

      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for invalid authorization format', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Invalid token',
      };

      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid authorization header format' })
      );
    });

    it('should extract Bearer token correctly', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Bearer valid.jwt.token',
      };

      // Mock verify to succeed
      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const mockVerifier = (CognitoJwtVerifier.create as jest.Mock)();
      const mockVerify = mockVerifier.verify as jest.Mock<Promise<any>>;
      mockVerify.mockResolvedValue({
        sub: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      });

      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual({
        sub: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      });
    });

    it('should handle expired tokens', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Bearer expired.jwt.token',
      };

      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const mockVerify = (CognitoJwtVerifier.create as jest.Mock)().verify as jest.Mock;
      mockVerify.mockRejectedValue(new Error('Token expired'));

      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Token expired' })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle invalid tokens', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Bearer invalid.jwt.token',
      };

      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const mockVerify = (CognitoJwtVerifier.create as jest.Mock)().verify as jest.Mock;
      mockVerify.mockRejectedValue(new Error('Invalid token signature'));

      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid token' })
      );
    });
  });

  describe('optionalAuth()', () => {
    it('should pass through when no auth header', async () => {
      await optionalAuth(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should pass through when verifier not initialized', async () => {
      mockReq.headers = {
        authorization: 'Bearer some.token',
      };

      await optionalAuth(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should attach user when valid token provided', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Bearer valid.jwt.token',
      };

      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const mockVerifier = (CognitoJwtVerifier.create as jest.Mock)();
      const mockVerify = mockVerifier.verify as jest.Mock<Promise<any>>;
      mockVerify.mockResolvedValue({
        sub: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      });

      await optionalAuth(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user?.sub).toBe('user-123');
    });

    it('should continue without user on invalid token', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Bearer invalid.token',
      };

      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const mockVerifier = (CognitoJwtVerifier.create as jest.Mock)();
      const mockVerify = mockVerifier.verify as jest.Mock<Promise<any>>;
      mockVerify.mockRejectedValue(new Error('Invalid token'));

      await optionalAuth(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('User Context', () => {
    it('should attach user info to request', async () => {
      initCognitoVerifier('us-east-1_test123', 'test-client-id');
      mockReq.headers = {
        authorization: 'Bearer valid.jwt.token',
      };

      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const mockVerify = (CognitoJwtVerifier.create as jest.Mock)().verify as jest.Mock;
      mockVerify.mockResolvedValue({
        sub: 'user-123',
        email: 'user@example.com',
        username: 'testuser',
      });

      await authenticateToken(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockReq.user).toEqual({
        sub: 'user-123',
        email: 'user@example.com',
        username: 'testuser',
      });
    });
  });
});
