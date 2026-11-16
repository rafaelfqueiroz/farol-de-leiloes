import { type BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service.js';
import { EmailService } from '../email/email.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { CompleteProfileDto } from './dto/complete-profile.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { UserAccount } from '../users/user-account.js';
import { UserProfile, AuthResult, JwtPayload } from './interfaces/auth.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import { normalizeEmail } from '../common/normalize-email.js';
import { AccountTokenService } from './tokens/account-token.service.js';
import { SessionsService } from './sessions/sessions.service.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';

@Injectable()
export class AuthService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(AuthService.name);
  /** Mail work started without being awaited (see `detach`). */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private accountTokens: AccountTokenService,
    private sessions: SessionsService,
    private loginAttempts: LoginAttemptsService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResult> {
    // BR-001-31: only email, name and password cross into the account; acceptTerms is checked by
    // the DTO (BR-001-02) and is not an account attribute.
    const user = await this.usersService.createLocalAccount({
      email: registerDto.email,
      name: registerDto.name,
      password: registerDto.password,
    });

    await this.sendConfirmationEmail(user);
    return this.startSession(user);
  }

  async login(loginDto: LoginDto, ip: string): Promise<AuthResult> {
    const email = normalizeEmail(loginDto.email);
    // BR-001-15: the attempt is counted, atomically, before the password is looked at, so parallel
    // guesses cannot all reach the comparison; over the limit it is refused even with the right
    // password.
    await this.loginAttempts.reserve(email, ip);

    const user = await this.usersService.validatePassword(email, loginDto.password);
    if (!user) {
      // BR-001-14: unknown email, wrong password and an inactive account are one answer. The
      // count the attempt reserved stays: nothing more to record.
      throw new DomainError('INVALID_CREDENTIALS');
    }

    await this.loginAttempts.recordSuccess(email, ip);
    return this.startSession(user);
  }

  async googleLogin(user: UserAccount): Promise<AuthResult> {
    return this.startSession(user);
  }

  /** BR-001-18: sign-out ends this session on the server, so a copy of the token stops working. */
  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // BR-001-21: the same visible response whether or not an account exists, and no email unless
    // one does. A deactivated or closed account is treated as absent (BR-001-16).
    if (!user || (user.status ?? 'active') !== 'active') return;

    // Everything after the lookup runs detached: the token's writes and the real send would
    // otherwise tell a known address from an unknown one by their delay (SC-05). A failure is
    // logged by kind only (SC-15). BR-001-24: works for Google-only accounts too. BR-001-22: the
    // new token replaces older ones.
    this.detach('Password reset email', async () => {
      const token = await this.accountTokens.issue(user._id.toString(), 'account_recovery');
      await this.emailService.sendPasswordResetEmail(user.email, token, user.name);
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // BR-001-22: single use, 1 hour; unknown, used and expired are the same answer.
    const record = await this.accountTokens.consume(token, 'account_recovery');
    if (!record) {
      throw new DomainError('INVALID_RESET_TOKEN');
    }

    // BR-001-24: finishing recovery adds email-and-password sign-in to a Google-only account.
    await this.usersService.setPassword(record.userId, newPassword);
    // BR-001-22: a successful reset kills every outstanding recovery link.
    await this.accountTokens.revokeUnused(record.userId, 'account_recovery');
    // BR-001-19: and every session; the reset does not sign anyone in.
    await this.sessions.revokeAllForUser(record.userId);
  }

  async updateProfile(userId: string, updateData: UpdateProfileDto): Promise<UserProfile> {
    const user = await this.usersService.update(userId, updateData);
    return this.toUserProfile(user);
  }

  async completeProfile(userId: string, dto: CompleteProfileDto): Promise<UserProfile> {
    const user = await this.usersService.update(userId, dto);
    return this.toUserProfile(user);
  }

  async getFullProfile(userId: string): Promise<UserProfile> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return this.toUserProfile(user);
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.providers?.includes('local')) {
      throw new DomainError('OAUTH_ACCOUNT_HAS_NO_PASSWORD');
    }

    // SC-04: a stolen session must not be able to guess the current password at bcrypt speed, so
    // this check shares sign-in's counters: the attempt is reserved first, a wrong password keeps
    // it, a right one gives it back.
    await this.loginAttempts.reserve(user.email, ip);
    const validPassword = await this.usersService.validatePassword(user.email, currentPassword);
    if (!validPassword) {
      throw new DomainError('CURRENT_PASSWORD_INCORRECT');
    }
    await this.loginAttempts.recordSuccess(user.email, ip);

    await this.usersService.changePassword(userId, newPassword);
    // BR-001-19: every other session ends; the one that changed the password stays.
    await this.sessions.revokeAllForUser(userId, sessionId);
  }

  async setPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (user.providers?.includes('local')) {
      throw new DomainError('PASSWORD_ALREADY_SET');
    }

    await this.usersService.setPassword(userId, newPassword);
  }

  /**
   * BR-001-17/18: opens a server-side session and signs a token that only points at it. The token
   * carries `sub` and `jti`; no email, name, role or plan (those are read per request).
   */
  private async startSession(user: UserAccount): Promise<AuthResult> {
    const userId = typeof user._id === 'string' ? user._id : user._id.toHexString();
    const jti = await this.sessions.create(userId);
    const payload: JwtPayload = { sub: userId, jti };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.toUserProfile(user),
    };
  }

  /** BR-001-05, BR-001-23: a fresh 24-hour link replaces any earlier one. */
  private async sendConfirmationEmail(user: UserAccount): Promise<void> {
    const userId = typeof user._id === 'string' ? user._id : user._id.toHexString();
    // Bound to the address it goes to: see verifyEmail.
    const token = await this.accountTokens.issue(userId, 'email_confirmation', {
      newEmail: user.email,
    });
    await this.deliver('Verification email', () =>
      this.emailService.sendVerificationEmail(user.email, token, user.name),
    );
  }

  /**
   * Runs mail work (token writes and the send) without making the request wait for it, so the
   * answer to a recovery request takes the same time for every address (SC-05). It is tracked, so
   * shutdown and tests can wait for it with `flushDeliveries`.
   */
  private detach(kind: string, task: () => Promise<void>): void {
    const run = this.deliver(kind, task);
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
  }

  /** Resolves once the mail work started so far has finished; it never rejects (see `deliver`). */
  async flushDeliveries(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.flushDeliveries(); // do not drop a recovery mail that is on its way out
  }

  /**
   * An account stays usable when the mail provider is down: the person can ask for another link
   * (BR-001-06). SC-15: the log line names the kind of mail and the error class, never the
   * address, the link or the provider's message (which can quote the recipient).
   */
  private async deliver(kind: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(
        `${kind} could not be sent (${error instanceof Error ? error.name : 'error'})`,
      );
    }
  }

  async verifyEmail(token: string): Promise<void> {
    // BR-001-05: single use, 24 hours; unknown, used, expired and replaced links answer alike.
    const record = await this.accountTokens.consume(token, 'email_confirmation');
    if (!record) {
      throw new DomainError('INVALID_VERIFICATION_TOKEN');
    }
    // The link confirms the address it was mailed to, only while that is still the account's
    // address. The email is immutable (BR-001-26, D-63), so this is defence in depth against any
    // write path that would change it (BR-001-04).
    if (
      !record.newEmail ||
      !(await this.usersService.confirmEmail(record.userId, record.newEmail))
    ) {
      throw new DomainError('INVALID_VERIFICATION_TOKEN');
    }
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.providers?.includes('local')) {
      throw new DomainError('OAUTH_ACCOUNT_NEEDS_NO_VERIFICATION');
    }

    if (user.emailVerified) {
      throw new DomainError('EMAIL_ALREADY_VERIFIED');
    }

    // BR-001-05/06: a new link makes the earlier unused ones stop working.
    await this.sendConfirmationEmail(user);
  }

  async getVerificationStatus(
    userId: string,
  ): Promise<{ emailVerified: boolean; providers: string[] }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return {
      emailVerified: user.emailVerified ?? false,
      providers: Array.from(user.providers),
    };
  }

  private toUserProfile(user: UserAccount): UserProfile {
    // AR-09 / SC-01: return detached public values, never hydrated document internals.
    return {
      _id: typeof user._id === 'string' ? user._id : user._id.toHexString(),
      email: user.email,
      name: user.name,
      providers: Array.from(user.providers),
      emailVerified: user.emailVerified ?? false,
      role: user.role ?? 'free',
      subscriptionStatus: user.subscriptionStatus ?? null,
      phone: user.phone,
      cpf: user.cpf,
      dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth) : undefined,
      sex: user.sex,
      address: user.address
        ? {
            street: user.address.street,
            city: user.address.city,
            state: user.address.state,
            zipCode: user.address.zipCode,
          }
        : undefined,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    };
  }
}
