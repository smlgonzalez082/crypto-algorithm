import { Request, Response, NextFunction } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import logger from '../utils/logger.js';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email?: string;
        username?: string;
      };
    }
  }
}

// Create verifier for Cognito access tokens
let accessTokenVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

/**
 * Initialize the Cognito JWT verifier
 * Must be called before using the auth middleware
 */
export function initCognitoVerifier(userPoolId: string, clientId: string): void {
  if (!userPoolId || !clientId) {
    logger.warn('Cognito User Pool ID or Client ID not provided. Authentication will be disabled.');
    return;
  }

  accessTokenVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  });

  logger.info(
    { userPoolId, clientId },
    'Cognito JWT verifier initialized'
  );
}

/**
 * Express middleware to verify Cognito JWT tokens
 * Checks Authorization header for Bearer token and verifies it
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip authentication if verifier not initialized (local dev mode)
  if (!accessTokenVerifier) {
    logger.debug('Cognito verifier not initialized, skipping authentication');
    next();
    return;
  }

  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logger.debug({ path: req.path }, 'No Authorization header provided');
      res.status(401).json({ error: 'No authorization token provided' });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      logger.debug({ authHeader }, 'Invalid Authorization header format');
      res.status(401).json({ error: 'Invalid authorization header format' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Cognito
    const payload = await accessTokenVerifier.verify(token);

    logger.debug(
      { sub: payload.sub, username: payload.username },
      'Token verified successfully'
    );

    // Attach user info to request object
    req.user = {
      sub: payload.sub,
      email: payload.email,
      username: payload.username,
    };

    next();
  } catch (error) {
    if (error instanceof Error) {
      logger.warn(
        { error: error.message, path: req.path },
        'Token verification failed'
      );

      // Provide specific error messages for common issues
      if (error.message.includes('expired')) {
        res.status(401).json({ error: 'Token expired' });
        return;
      }

      if (error.message.includes('invalid')) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
    }

    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional middleware for endpoints that work with or without authentication
 * Verifies token if present, but doesn't block if missing
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!accessTokenVerifier) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided, continue without user info
    next();
    return;
  }

  try {
    const token = authHeader.substring(7);
    const payload = await accessTokenVerifier.verify(token);

    req.user = {
      sub: payload.sub,
      email: payload.email,
      username: payload.username,
    };

    logger.debug({ sub: payload.sub }, 'Optional auth: user authenticated');
  } catch (error) {
    // Token invalid, but we don't block the request
    logger.debug({ error }, 'Optional auth: token verification failed, continuing without auth');
  }

  next();
}
