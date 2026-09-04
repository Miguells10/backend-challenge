import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID, ValidateNested } from 'class-validator';

import { MoneyDto } from '../../http/dto/money.dto';

export class CreateWalletDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public playerId!: string;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  public initialBalance!: MoneyDto;
}
