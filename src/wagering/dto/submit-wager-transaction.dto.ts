import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

import { MoneyDto } from '../../http/dto/money.dto';
import {
  EXTERNAL_WAGER_TRANSACTION_KINDS,
  WagerTransactionKind,
} from '../../domain/wagering/wager-transaction';

export class SubmitWagerTransactionDto {
  @ApiProperty()
  @IsString()
  public providerId!: string;

  @ApiProperty()
  @IsString()
  public externalTransactionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public playerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public walletId!: string;

  @ApiProperty()
  @IsString()
  public roundId!: string;

  @ApiProperty()
  @IsString()
  public gameId!: string;

  @ApiProperty({ enum: EXTERNAL_WAGER_TRANSACTION_KINDS, example: WagerTransactionKind.Bet })
  @IsIn(EXTERNAL_WAGER_TRANSACTION_KINDS)
  public kind!: WagerTransactionKind;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  public money!: MoneyDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public referenceExternalTransactionId?: string;
}
