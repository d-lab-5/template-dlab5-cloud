// Two-step sign-in for the people who manage a tenant or the platform
// (audit 2026-10-01, H-3). The pool's MFA is OPTIONAL (TOTP), so family
// members who only look are not asked; admins are, here and in the site.
//
// The check asks Cognito itself (AdminGetUser), not the token: an ID token
// says nothing about MFA, and a client can claim anything.

import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

export async function hasMfa(userPoolId: string, username: string): Promise<boolean> {
  const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  return (u.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
}

export class MfaRequired extends Error {
  constructor() {
    super("Turn on two-step sign-in first (Settings → Two-step sign-in): it is required to manage a tenant or edges.");
  }
}

/** Throws MfaRequired unless this admin has an authenticator app set up. */
export async function requireMfa(userPoolId: string | undefined, username: string | undefined): Promise<void> {
  if (!userPoolId || !username || !(await hasMfa(userPoolId, username))) throw new MfaRequired();
}
