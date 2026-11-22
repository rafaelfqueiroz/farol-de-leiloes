import { type ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { isGoogleFlowIntent } from '../google/google-oauth-state.seal.js';
import { GOOGLE_INTENT_PARAM } from '../google/google-oauth-state.store.js';

/**
 * The Google start and callback routes. SPEC-010 BR-010-13: a RE-AUTHENTICATION must be a new,
 * interactive Google sign-in, not a silent redirect that an existing Google session answers by
 * itself (which any script of the site could then trigger), so the start for `intent=reauth` asks
 * Google for `prompt=login`. A normal sign-in sends no extra option and is unchanged. The intent is
 * read from the same query parameter the state store validates (an unknown value never reaches
 * Google: the store refuses it); the callback decides from the sealed cookie only.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override getAuthenticateOptions(context: ExecutionContext): { prompt: string } | undefined {
    const intent: unknown = context.switchToHttp().getRequest<Request>().query?.[
      GOOGLE_INTENT_PARAM
    ];
    return isGoogleFlowIntent(intent) ? { prompt: 'login' } : undefined;
  }
}
