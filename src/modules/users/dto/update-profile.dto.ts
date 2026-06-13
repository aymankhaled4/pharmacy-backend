import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ahmed Mohamed' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  full_name?: string;

  @ApiPropertyOptional({ example: '+201012345678' })
  @IsOptional()
  @IsString()
  @Matches(/^(\+20|0)?1[0-2,5]{1}[0-9]{8}$/, {
    message: 'Invalid Egyptian phone number',
  })
  phone?: string;
}
