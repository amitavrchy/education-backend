import { IsEnum, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { RoleKey } from '../../../common/enums/role.enum.js';

export class LoginDto {
  /** Email address or Bangladeshi mobile number (01XXXXXXXXX). */
  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

/** Self-registration is limited to these roles; staff accounts are created by admins. */
export const SELF_REGISTRATION_ROLES = [RoleKey.STUDENT, RoleKey.PARENT, RoleKey.TEACHER] as const;

export class RegisterDto {
  @IsString()
  @Length(2, 150)
  fullName: string;

  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsEnum(RoleKey)
  role: (typeof SELF_REGISTRATION_ROLES)[number];
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class RequestOtpDto {
  @Matches(/^(?:\+?88)?01[3-9]\d{8}$/, {
    message: 'phone must be a valid Bangladeshi mobile number',
  })
  phone: string;
}
