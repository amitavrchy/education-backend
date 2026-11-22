import { Injectable, NotImplementedException } from '@nestjs/common';
import type { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto.js';
import type { AuthTokens, SessionContext } from './interfaces/auth.interfaces.js';

/**
 * Orchestrates sign-in flows. NOT IMPLEMENTED YET — the building blocks are in place:
 *   PasswordHasherService  (scrypt, timing-safe verify)
 *   TokenService           (JWT access tokens, hashed opaque refresh tokens)
 *   UserSession table      (refresh-token sessions, revocation)
 *   CredentialStrategy     (email/phone password, phone OTP)
 *
 * Planned login flow: normalize identifier → find user → passwordHasher.verify (always) →
 * check status → load roles+permissions → create UserSession → sign tokens → audit log.
 */
@Injectable()
export class AuthService {
  login(_dto: LoginDto, _context: SessionContext): Promise<AuthTokens> {
    throw new NotImplementedException('Login is not implemented yet');
  }

  register(_dto: RegisterDto): Promise<AuthTokens> {
    throw new NotImplementedException('Registration is not implemented yet');
  }

  refresh(_dto: RefreshTokenDto, _context: SessionContext): Promise<AuthTokens> {
    throw new NotImplementedException('Token refresh is not implemented yet');
  }

  logout(_sessionId: string | undefined): Promise<void> {
    throw new NotImplementedException('Logout is not implemented yet');
  }
}
