import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_ROLES, type UserRole } from '../../../contracts/user.js';

export class LoginDto {
  /** Email address or Bangladeshi mobile number (01XXXXXXXXX). */
  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class OtpRequestDto {
  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

/** Self-registration is limited to students and guardians; staff accounts are created by admins. */
export const SELF_REGISTRATION_ROLES = ['student', 'parent'] as const;

export class RegisterDto {
  @IsString()
  @Length(2, 150)
  name: string;

  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsIn(['email', 'phone'])
  channel: 'email' | 'phone';

  @IsIn(SELF_REGISTRATION_ROLES)
  role: (typeof SELF_REGISTRATION_ROLES)[number];

  @IsBoolean()
  under18: boolean;

  /** Optional: OTP-only accounts can set a password later via reset. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class ForgotPasswordDto {
  @IsString()
  @MaxLength(254)
  identifier: string;
}

export class OtpChallengeDto {
  @IsString()
  @Length(36, 36)
  challengeId: string;
}

export class VerifyOtpDto extends OtpChallengeDto {
  @IsString()
  @Length(4, 8)
  code: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 300)
  token: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class SwitchRoleDto {
  @IsIn(USER_ROLES)
  role: UserRole;
}
