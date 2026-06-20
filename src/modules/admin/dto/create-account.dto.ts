import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  Matches,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty({ example: 'newuser@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  @IsString()
  @MaxLength(100)
  full_name!: string;

  @ApiPropertyOptional({
    enum: ['user', 'admin'],
    default: 'user',
    description: 'Account type to create',
  })
  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin' = 'user';

  @ApiPropertyOptional({
    example: '01012345678',
    description: 'Required for patients (role=user)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\+20|0)?1[0-2,5]{1}[0-9]{8}$/, {
    message: 'Invalid Egyptian phone number',
  })
  phone?: string;
}
