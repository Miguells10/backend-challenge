import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class MoneyDto {
  @ApiProperty({ example: '100.00', pattern: '^\\d+\\.\\d{2}$' })
  @IsString({ message: 'amount deve ser enviado como texto, por exemplo: "100.00".' })
  @Matches(/^\d+\.\d{2}$/, { message: 'amount deve ter duas casas decimais, por exemplo: 100.00.' })
  public amount!: string;

  @ApiProperty({ example: 'BRL', pattern: '^[A-Z]{3}$' })
  @IsString({ message: 'currency deve ser enviado como texto, por exemplo: "BRL".' })
  @Matches(/^[A-Z]{3}$/, { message: 'currency deve ter exatamente três letras maiúsculas, por exemplo: BRL.' })
  public currency!: string;
}
