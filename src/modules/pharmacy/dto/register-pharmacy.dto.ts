import {
  IsString,
  IsEmail,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RegisterPharmacyDto {
  @ApiProperty({ example: 'pharmacy@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: 'El Nour Pharmacy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  pharmacy_name!: string;

  @ApiProperty({ example: '+201012345678' })
  @IsString()
  @Matches(/^(\+20|0)?1[0-2,5]{1}[0-9]{8}$/, {
    message: 'Invalid Egyptian phone number',
  })
  phone!: string;

  @ApiProperty({ example: '15 Tahrir Street, Downtown' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address!: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'PH-LIC-2024-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  license_number!: string;

  @ApiProperty({ example: 30.0444, description: 'Latitude' })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 31.2357, description: 'Longitude' })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}
