import { Body, ConflictException, Controller, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { canonicalPayloadHash } from '../application/idempotency/canonical-payload-hash';
import { IdempotencyConflictError, ProcessWagerTransactionUseCase, WalletNotFoundError } from '../application/wagering/process-wager-transaction.use-case';
import { Money } from '../domain/money/money';
import { WagerTransactionStatus } from '../domain/wagering/wager-transaction';
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

  @Post('wagering/transactions') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Submete uma transação financeira' })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse({ description: 'Transação processada, rejeitada ou pendente.' })
  public async submit(@Headers('idempotency-key') idempotencyKey: string | undefined, @Body() dto: SubmitWagerTransactionDto, @Res({ passthrough: true }) response: HttpResponse) {
    if (idempotencyKey === undefined || idempotencyKey === '') throw new ConflictException('Idempotency-Key is required.');
    try {
      const result = await this.processWager.execute({ id: crypto.randomUUID(), ...dto, idempotencyKey,
        payloadHash: canonicalPayloadHash(dto), money: Money.from(dto.money), occurredAt: new Date() });
      if (result.status === WagerTransactionStatus.PendingReference) response.status(HttpStatus.ACCEPTED);
      return { ...result, balance: result.balance.toJSON() };
    } catch (error) {
      if (error instanceof WalletNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof IdempotencyConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get('wagering/transactions/:transactionId') @ApiOperation({ summary: 'Consulta uma transação por id interno' })
  public async getById(@Param('transactionId') transactionId: string) {
    return this.read(() => this.getWagerTransaction.byId(transactionId));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  @ApiOperation({ summary: 'Consulta uma transação por identidade externa do provedor' })
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
