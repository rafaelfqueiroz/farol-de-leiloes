import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:is-public';

/** SC-07: anonymous access is an explicit decision; new routes require a JWT by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
