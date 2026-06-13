import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePharmacyProfileDto {
  @ApiPropertyOptional({ example: 'El Nour Pharmacy' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pharmacy_name?: string;

  @ApiPropertyOptional({ example: '+201012345678' })
  @IsOptional()
  @IsString()
  @Matches(/^(\+20|0)?1[0-2,5]{1}[0-9]{8}$/, {
    message: 'Invalid Egyptian phone number',
  })
  phone?: string;

  @ApiPropertyOptional({ example: '15 Tahrir Street, Downtown' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'Cairo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}
