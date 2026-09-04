import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class MoneyDto {
  @ApiProperty({ example: '100.00', pattern: '^\\d+\\.\\d{2}$' })
  @IsString()
  @Matches(/^\d+\.\d{2}$/)
  public amount!: string;

  @ApiProperty({ example: 'BRL', pattern: '^[A-Z]{3}$' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  public currency!: string;
}
