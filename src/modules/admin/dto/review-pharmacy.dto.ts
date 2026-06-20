import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReviewPharmacyDto {
  @ApiProperty({ example: 'License document is expired or unreadable.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  rejection_reason!: string;
}
