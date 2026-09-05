/**
 * Boundary for authenticating the provider that submits an HTTP transaction.
 * The challenge uses a no-op implementation; production can replace it with
 * an OIDC client-credentials adapter without changing financial use cases.
 */
export interface ProviderIdentityPort {
  assertCanSubmit(providerId: string): Promise<void>;
}

export const PROVIDER_IDENTITY_PORT = Symbol('ProviderIdentityPort');
