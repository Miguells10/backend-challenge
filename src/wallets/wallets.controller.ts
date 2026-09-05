import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { Money } from '../domain/money/money';
import { CreateWalletUseCase } from './create-wallet.use-case';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { GetWalletUseCase, WalletNotFoundError } from './get-wallet.use-case';
import { ListWalletsUseCase } from './list-wallets.use-case';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  public constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly listWallets: ListWalletsUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma wallet com abertura auditável' })
  @ApiCreatedResponse({ description: 'Wallet criada.' })
  @ApiBadRequestResponse({ description: 'Contrato HTTP ou valor monetário inválido.' })
  @ApiConflictResponse({ description: 'Já existe uma wallet para o jogador e a moeda.' })
  public async create(@Body() dto: CreateWalletDto) {
    try {
      return await this.createWallet.execute({
        playerId: dto.playerId,
        initialBalance: Money.from(dto.initialBalance),
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException('A wallet already exists for this player and currency.');
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Lista wallets para consulta operacional' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Quantidade de wallets, de 1 a 100.' })
  @ApiOkResponse({ description: 'Lista limitada de wallets, em ordem de criação decrescente.' })
  @ApiBadRequestResponse({ description: 'O limite deve ser um inteiro entre 1 e 100.' })
  public async list(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('Limit must be an integer between 1 and 100.');
    }

    return this.listWallets.execute(limit);
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Consulta o saldo atual da wallet' })
  @ApiNotFoundResponse({ description: 'Wallet não encontrada.' })
  public async get(@Param('walletId') walletId: string) {
    try {
      return await this.getWallet.execute(walletId);
    } catch (error) {
      if (error instanceof WalletNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
