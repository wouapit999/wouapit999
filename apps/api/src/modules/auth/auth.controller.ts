import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AuthService, type SessionMeta } from './auth.service.js';
import {
  AdminLoginDto,
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  MfaDisableDto,
  MfaEnableDto,
  MfaVerifyDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshTokenDto,
  RegisterDto,
} from './dto/auth.dto.js';

/** Credential endpoints: 10 attempts per minute per client IP. */
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

function sessionMeta(request: Request): SessionMeta {
  const userAgent = request.headers['user-agent'];
  return { ip: request.ip ?? null, userAgent: typeof userAgent === 'string' ? userAgent : null };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @Throttle(CREDENTIAL_THROTTLE)
  @Audit({ action: 'auth.register', resource: 'User' })
  @ApiOperation({ summary: 'Create a customer account and start a session' })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.auth.register(dto, sessionMeta(request));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  @Audit({ action: 'auth.login', resource: 'User' })
  @ApiOperation({
    summary: 'Password login (customer realm by default); may return an MFA challenge',
  })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, { ...sessionMeta(request), deviceName: dto.deviceName ?? null });
  }

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  @Audit({ action: 'auth.admin-login', resource: 'User' })
  @ApiOperation({ summary: 'Password login for the ADMIN realm; may return an MFA challenge' })
  adminLogin(@Body() dto: AdminLoginDto, @Req() request: Request) {
    return this.auth.authenticate('ADMIN', dto.email, dto.password, {
      ...sessionMeta(request),
      deviceName: dto.deviceName ?? null,
    });
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  @Audit({ action: 'auth.mfa.verify', resource: 'User' })
  @ApiOperation({ summary: 'Complete a login that required a TOTP code' })
  verifyMfa(@Body() dto: MfaVerifyDto, @Req() request: Request) {
    return this.auth.verifyMfa(dto, sessionMeta(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Audit({ action: 'auth.refresh', resource: 'RefreshToken' })
  @ApiOperation({ summary: 'Rotate a refresh token (reuse revokes the whole token family)' })
  refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    return this.auth.refresh(dto, sessionMeta(request));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'auth.logout', resource: 'RefreshToken' })
  @ApiOperation({
    summary: 'Revoke the current session (or a given refresh token, or all devices)',
  })
  logout(@CurrentUser() principal: AuthenticatedPrincipal, @Body() dto: LogoutDto) {
    return this.auth.logout(principal, dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Profile, roles and permissions of the caller' })
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal);
  }

  @Public()
  @Post('password/reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(CREDENTIAL_THROTTLE)
  @Audit({ action: 'auth.password.reset-request', resource: 'User' })
  @ApiOperation({ summary: 'E-mail a password reset link (always 202, no enumeration)' })
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto): Promise<{ accepted: true }> {
    await this.auth.requestPasswordReset(dto);
    return { accepted: true };
  }

  @Public()
  @Post('password/reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(CREDENTIAL_THROTTLE)
  @Audit({ action: 'auth.password.reset-confirm', resource: 'User' })
  @ApiOperation({ summary: 'Set a new password with a reset or invitation token' })
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto): Promise<void> {
    await this.auth.confirmPasswordReset(dto);
  }

  @ApiBearerAuth()
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'auth.password.change', resource: 'User' })
  @ApiOperation({ summary: 'Change the password of the caller (signs out other devices)' })
  async changePassword(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(principal, dto);
  }

  @ApiBearerAuth()
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'auth.mfa.setup', resource: 'User' })
  @ApiOperation({ summary: 'Start TOTP enrolment: returns the secret and otpauth URI once' })
  setupMfa(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.setupMfa(principal);
  }

  @ApiBearerAuth()
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'auth.mfa.enable', resource: 'User' })
  @ApiOperation({ summary: 'Confirm TOTP enrolment with a code from the authenticator app' })
  enableMfa(@CurrentUser() principal: AuthenticatedPrincipal, @Body() dto: MfaEnableDto) {
    return this.auth.enableMfa(principal, dto);
  }

  @ApiBearerAuth()
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'auth.mfa.disable', resource: 'User' })
  @ApiOperation({ summary: 'Disable TOTP (requires password and a current code)' })
  disableMfa(@CurrentUser() principal: AuthenticatedPrincipal, @Body() dto: MfaDisableDto) {
    return this.auth.disableMfa(principal, dto);
  }
}
