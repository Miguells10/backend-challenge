import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { canonicalPayloadHash } from '../application/idempotency/canonical-payload-hash';
import { IdempotencyConflictError, ProcessWagerTransactionUseCase, WalletNotFoundError } from '../application/wagering/process-wager-transaction.use-case';
import { CurrencyMismatchError, Money, MoneyValidationError } from '../domain/money/money';
import {
  InvalidWagerTransactionError,
  WagerTransactionStatus,
} from '../domain/wagering/wager-transaction';
import { SubmitWagerTransactionDto } from './dto/submit-wager-transaction.dto';
import { GetWagerTransactionUseCase, WagerTransactionNotFoundError } from './get-wager-transaction.use-case';

interface HttpResponse { status(code: number): unknown; }

@ApiTags('Wagering')
@Controller()
export class WageringController {
  public constructor(
    private readonly processWager: ProcessWagerTransactionUseCase,
    private readonly getWagerTransaction: GetWagerTransactionUseCase,
  ) {}

  @Post('wagering/transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submete uma transação financeira' })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    schema: { example: 'provider-demo:bet-demo-001' },
    description: 'Identificador único da operação; reutilize-o somente ao repetir a mesma requisição.',
  })
  @ApiOkResponse({ description: 'Transação processada ou rejeitada.' })
  @ApiAcceptedResponse({ description: 'Transação aguardando sua referência.' })
  @ApiBadRequestResponse({ description: 'Contrato HTTP ou regra de negócio inválida.' })
  @ApiNotFoundResponse({ description: 'Wallet não encontrada.' })
  @ApiConflictResponse({ description: 'Chave de idempotência inválida ou transação externa já registrada.' })
  public async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: SubmitWagerTransactionDto,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      throw new ConflictException('Idempotency-Key is required.');
    }

    try {
      const result = await this.processWager.execute({
        id: crypto.randomUUID(),
        ...dto,
        idempotencyKey,
        payloadHash: canonicalPayloadHash(dto),
        money: Money.from(dto.money),
        occurredAt: new Date(),
      });
      if (result.status === WagerTransactionStatus.PendingReference) response.status(HttpStatus.ACCEPTED);
      return { ...result, balance: result.balance.toJSON() };
    } catch (error) {
      if (error instanceof WalletNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof IdempotencyConflictError) throw new ConflictException(error.message);
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException('Esta transação externa já foi registrada para o provedor informado.');
      }
      if (isClientInputError(error)) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get('wagering/transactions/:transactionId')
  @ApiOperation({ summary: 'Consulta uma transação por id interno' })
  @ApiNotFoundResponse({ description: 'Transação não encontrada.' })
  public async getById(@Param('transactionId') transactionId: string) {
    return this.read(() => this.getWagerTransaction.byId(transactionId));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  @ApiOperation({
    summary: 'Consulta uma transação pelo identificador do provedor',
    description: 'Permite ao provedor consultar uma transação usando o identificador que ele próprio enviou, sem conhecer o UUID interno da plataforma.',
  })
  @ApiParam({ name: 'providerId', example: 'provider-http', description: 'Identificador do provedor que originou a transação.' })
  @ApiParam({ name: 'externalTransactionId', example: 'bet-http-1', description: 'Identificador da transação no sistema do provedor.' })
  @ApiNotFoundResponse({ description: 'Transação não encontrada.' })
  public async getByExternal(@Param('providerId') providerId: string, @Param('externalTransactionId') externalTransactionId: string) {
    return this.read(() => this.getWagerTransaction.byExternalId(providerId, externalTransactionId));
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof WagerTransactionNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}

function isClientInputError(error: unknown): error is Error {
  return error instanceof MoneyValidationError
    || error instanceof CurrencyMismatchError
    || error instanceof InvalidWagerTransactionError;
}
