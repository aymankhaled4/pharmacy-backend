import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReviewPharmacyDto {
  @ApiProperty({ example: 'License document is expired or invalid' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  rejection_reason!: string;
}
