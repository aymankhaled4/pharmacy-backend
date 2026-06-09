import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ConfirmPickupDto {
  @ApiProperty({ example: 'MC-1234' })
  @IsString()
  @Matches(/^MC-[A-Z0-9]{4}$/i, {
    message: 'shortCode must match MC-XXXX',
  })
  shortCode!: string;
}
