import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SoftDeleteUserDto {
  @ApiPropertyOptional({ example: 'User requested account deletion' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
