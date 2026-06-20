import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination (base64 encoded)',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_deleted?: boolean = false;

  @ApiPropertyOptional({
    enum: ['user', 'admin'],
    description: 'Filter by account role',
  })
  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @ApiPropertyOptional({ enum: ['active', 'blocked', 'deleted'] })
  @IsOptional()
  @IsIn(['active', 'blocked', 'deleted'])
  status?: 'active' | 'blocked' | 'deleted';
}
