import { Injectable } from '@nestjs/common';

import { type ProviderIdentityPort } from '../../application/identity/provider-identity.port';

@Injectable()
export class NoOpProviderIdentityAdapter implements ProviderIdentityPort {
  public async assertCanSubmit(): Promise<void> {}
}
