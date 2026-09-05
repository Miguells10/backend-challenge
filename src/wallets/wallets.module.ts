import { Module } from '@nestjs/common';

import { MikroOrmWalletRepository } from '../infrastructure/persistence/repositories/mikro-orm-wallet.repository';
import { CreateWalletUseCase } from './create-wallet.use-case';
import { GetWalletUseCase } from './get-wallet.use-case';
import { ListWalletsUseCase } from './list-wallets.use-case';
import { ReconcileWalletUseCase } from './reconcile-wallet.use-case';
import { WALLET_REPOSITORY } from './wallet.repository';
import { WalletsController } from './wallets.controller';

@Module({
  controllers: [WalletsController],
  providers: [
    CreateWalletUseCase,
    GetWalletUseCase,
    ListWalletsUseCase,
    ReconcileWalletUseCase,
    MikroOrmWalletRepository,
    { provide: WALLET_REPOSITORY, useExisting: MikroOrmWalletRepository },
  ],
})
export class WalletsModule {}
