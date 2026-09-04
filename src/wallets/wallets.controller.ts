import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Money } from '../domain/money/money';
import { CreateWalletUseCase } from './create-wallet.use-case';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { GetWalletUseCase, WalletNotFoundError } from './get-wallet.use-case';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  public constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
  ) {}

  @Post() @ApiOperation({ summary: 'Cria uma wallet com abertura auditável' }) @ApiCreatedResponse({ description: 'Wallet criada.' })
  public async create(@Body() dto: CreateWalletDto) { return this.createWallet.execute({ playerId: dto.playerId, initialBalance: Money.from(dto.initialBalance) }); }

  @Get(':walletId') @ApiOperation({ summary: 'Consulta o saldo atual da wallet' }) @ApiNotFoundResponse({ description: 'Wallet não encontrada.' })
  public async get(@Param('walletId') walletId: string) {
    try {
      return await this.getWallet.execute(walletId);
    } catch (error) {
      if (error instanceof WalletNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
